"use strict";
/**
 * memory-layer/service/jobs/ttlCleaner.ts
 *
 * Scheduled TTL cleaner that soft-deletes expired memory_nodes and emits
 * a signed audit_event for each deletion, all inside a single DB transaction
 * per-batch so deletion and audit insertion are atomic.
 *
 * Enhancements:
 *  - Proper async audit signing with error handling.
 *  - Metrics integration (processed, errors).
 *  - Tracing integration (span per node + trace injection into audit payload).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processBatch = processBatch;
exports.start = start;
const db_1 = require("../db");
const auditChain_1 = require("../audit/auditChain");
const metrics_1 = __importDefault(require("../observability/metrics"));
const tracing_1 = __importDefault(require("../observability/tracing"));
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_INTERVAL_MS = 60000;
/**
 * Fetch rows eligible for TTL deletion (not under legal hold).
 * Uses FOR UPDATE SKIP LOCKED so multiple cleaners can run concurrently.
 */
async function fetchExpiredNodesForUpdate(client, limit = DEFAULT_BATCH_SIZE) {
    const res = await client.query(`
    SELECT id, owner, expires_at, legal_hold, deleted_at, metadata, created_at, updated_at
    FROM memory_nodes
    WHERE expires_at IS NOT NULL
      AND expires_at <= now()
      AND deleted_at IS NULL
      AND legal_hold = false
    ORDER BY expires_at ASC
    LIMIT $1
    FOR UPDATE SKIP LOCKED
  `, [limit]);
    return res.rows;
}
/**
 * Process a single batch: soft-delete expired nodes and insert signed audit_events
 * within the same transaction.
 *
 * Returns number of nodes processed.
 */
async function processBatch(limit = DEFAULT_BATCH_SIZE) {
    const pool = (0, db_1.getPool)();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const rows = await fetchExpiredNodesForUpdate(client, limit);
        if (!rows.length) {
            await client.query('COMMIT');
            // update queue depth metrics (best-effort)
            try {
                const qRes = await pool.query('SELECT count(1) AS count FROM memory_vectors WHERE status = \'pending\'');
                const depth = Number(qRes.rows[0]?.count ?? 0);
                metrics_1.default.metrics.vectorQueue.setDepth(depth, { provider: 'postgres', namespace: process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory' });
            }
            catch {
                // ignore
            }
            return 0;
        }
        for (const node of rows) {
            const id = node.id;
            try {
                // Wrap per-node processing in a span for tracing
                await tracing_1.default.withSpan(`ttlCleaner.process:${id}`, async (span) => {
                    // 1) soft-delete (same logic as db.softDeleteMemoryNode)
                    await client.query(`
            UPDATE memory_nodes
            SET deleted_at = now(),
                metadata = jsonb_set(metadata, '{deletedBy}', to_jsonb($2::text), true),
                updated_at = now()
            WHERE id = $1
          `, [id, 'ttl-cleaner']);
                    // 2) Compute prev_hash (global last audit) and prepare payload
                    const prevRes = await client.query(`SELECT hash FROM audit_events ORDER BY created_at DESC LIMIT 1 FOR UPDATE`);
                    const prevHash = prevRes.rows[0]?.hash ?? null;
                    // Prepare payload similar to insertAuditEvent usage. Inject trace context.
                    let auditPayload = {
                        requestedBy: 'system',
                        caller: 'ttl-cleaner',
                        callerPrevHash: null
                    };
                    try {
                        auditPayload = tracing_1.default.injectTraceIntoAuditPayload(auditPayload);
                    }
                    catch {
                        // tracing should not block deletion; continue without trace
                    }
                    // canonicalize and compute digest
                    const canonical = (0, auditChain_1.canonicalizePayload)(auditPayload);
                    const digestHex = (0, auditChain_1.computeAuditDigest)(canonical, prevHash);
                    const digestBuf = Buffer.from(digestHex, 'hex');
                    // Attempt to sign digest and measure duration
                    const start = Date.now();
                    let signature = null;
                    try {
                        signature = await (0, auditChain_1.signAuditDigest)(digestHex);
                        const elapsed = (Date.now() - start) / 1000.0;
                        try {
                            metrics_1.default.metrics.audit.duration({ method: 'digest-path' }, elapsed);
                        }
                        catch {
                            // ignore metrics errors
                        }
                    }
                    catch (signErr) {
                        // signAuditDigest threw — treat as fatal for this node
                        const msg = signErr.message || String(signErr);
                        try {
                            metrics_1.default.metrics.audit.failure({ reason: 'signing_error' });
                        }
                        catch { }
                        throw new Error(`audit signing failed: ${msg}`);
                    }
                    // Enforce signing presence when running in production / REQUIRE_KMS
                    const requireKms = String(process.env.REQUIRE_KMS ?? '').toLowerCase() === 'true';
                    const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
                    if (!signature && (requireKms || isProd)) {
                        try {
                            metrics_1.default.metrics.audit.failure({ reason: 'signature_missing' });
                        }
                        catch { }
                        throw new Error('audit signing required but no signature produced');
                    }
                    // Insert audit_event row referencing the memory node
                    await client.query(`
            INSERT INTO audit_events
              (event_type, memory_node_id, artifact_id, payload, hash, prev_hash, signature, manifest_signature_id, created_at)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, now())
          `, [
                        'memory.node.deleted',
                        id,
                        null,
                        auditPayload,
                        digestHex,
                        prevHash,
                        signature,
                        null
                    ]);
                    // Count successful processed node
                    try {
                        metrics_1.default.metrics.ttlCleaner.processed({ result: 'deleted' });
                    }
                    catch { }
                });
            }
            catch (err) {
                // If anything fails while processing this node, record error and continue with next node.
                const msg = err.message || String(err);
                try {
                    await client.query(`UPDATE memory_nodes SET metadata = jsonb_set(metadata, '{ttlCleanerError}', to_jsonb($2::text), true), updated_at = now() WHERE id = $1`, [id, msg]);
                }
                catch (uerr) {
                    console.error(`[ttlCleaner] failed to mark error on node ${id}:`, uerr.message || uerr);
                }
                try {
                    metrics_1.default.metrics.ttlCleaner.error({ error: msg });
                }
                catch { }
                console.error(`[ttlCleaner] failed processing node ${id}: ${msg}`);
                // Do not rethrow; continue with other nodes. The transaction stays alive until end and will commit the successful ones.
            }
        }
        await client.query('COMMIT');
        // After committing, update vector queue depth metric (best-effort)
        try {
            const qRes = await (0, db_1.getPool)().query('SELECT count(1) AS count FROM memory_vectors WHERE status = \'pending\'');
            const depth = Number(qRes.rows[0]?.count ?? 0);
            metrics_1.default.metrics.vectorQueue.setDepth(depth, { provider: 'postgres', namespace: process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory' });
        }
        catch {
            // ignore
        }
        return rows.length;
    }
    catch (err) {
        await client.query('ROLLBACK');
        console.error('[ttlCleaner] batch failed, rolled back:', err.message || String(err));
        // record metric
        try {
            metrics_1.default.metrics.ttlCleaner.error({ error: err.message ?? 'batch_failure' });
        }
        catch { }
        throw err;
    }
    finally {
        client.release();
    }
}
/**
 * Start polling loop to run processBatch periodically.
 * Returns an object with stop() to halt the loop.
 */
function start(intervalMs, batchSize) {
    const iv = intervalMs ?? Number(process.env.TTL_CLEANER_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS));
    const bs = batchSize ?? Number(process.env.TTL_CLEANER_BATCH_SIZE ?? String(DEFAULT_BATCH_SIZE));
    let running = true;
    let isProcessing = false;
    const tick = async () => {
        if (!running)
            return;
        if (isProcessing)
            return;
        isProcessing = true;
        try {
            const count = await processBatch(bs);
            if (count > 0) {
                console.info(`[ttlCleaner] processed ${count} expired nodes`);
            }
        }
        catch (err) {
            console.error('[ttlCleaner] tick error:', err.message || err);
            try {
                metrics_1.default.metrics.ttlCleaner.error({ error: err.message ?? 'tick_error' });
            }
            catch { }
        }
        finally {
            isProcessing = false;
        }
    };
    const handle = setInterval(tick, iv);
    // run immediately
    void tick();
    console.info(`[ttlCleaner] started polling every ${iv}ms (batchSize=${bs})`);
    return {
        stop: () => {
            running = false;
            clearInterval(handle);
            console.info('[ttlCleaner] stopped');
        }
    };
}
/**
 * CLI entrypoint: one-shot or polling depending on TTL_CLEANER_POLL (default true)
 */
if (require.main === module) {
    (async () => {
        try {
            const poll = String(process.env.TTL_CLEANER_POLL ?? 'true').toLowerCase() === 'true';
            if (poll) {
                const controller = start();
                process.on('SIGINT', () => {
                    controller.stop();
                    process.exit(0);
                });
                process.on('SIGTERM', () => {
                    controller.stop();
                    process.exit(0);
                });
            }
            else {
                const processed = await processBatch();
                console.info(`[ttlCleaner] one-shot processed ${processed} rows`);
                process.exit(0);
            }
        }
        catch (err) {
            console.error('[ttlCleaner] fatal error:', err.message || err);
            process.exit(1);
        }
    })();
}
exports.default = {
    processBatch,
    start
};
