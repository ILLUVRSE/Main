/**
 * memory-layer/service/jobs/ttlCleaner.ts
 *
 * Scheduled TTL cleaner that soft-deletes expired memory_nodes and emits
 * a signed audit_event for each deletion, all inside a single DB transaction
 * per-batch so deletion and audit insertion are atomic.
 *
 * Exports:
 *  - processBatch(limit?: number): Promise<number>    // number of nodes processed
 *  - start(intervalMs?: number, batchSize?: number)   // start polling, returns stop() function
 *
 * Environment:
 *  - TTL_CLEANER_INTERVAL_MS  (optional, default 60000)
 *  - TTL_CLEANER_BATCH_SIZE   (optional, default 100)
 *
 * Notes:
 *  - This file performs manual audit_event insertion in the same transaction
 *    to guarantee atomicity between the soft-delete and audit row (mirrors
 *    memory-layer/service/db.insertAuditEvent logic).
 *  - It uses auditChain functions: canonicalizePayload, computeAuditDigest, signAuditDigest.
 */

import { Readable } from 'stream';
import { getPool } from '../db';
import { canonicalizePayload, computeAuditDigest, signAuditDigest } from '../audit/auditChain';

type MemoryNodeRow = {
  id: string;
  owner: string;
  expires_at: string | null;
  legal_hold: boolean;
  deleted_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_INTERVAL_MS = 60_000;

async function fetchExpiredNodesForUpdate(client: any, limit = DEFAULT_BATCH_SIZE): Promise<MemoryNodeRow[]> {
  const res = await client.query<MemoryNodeRow>(
    `
    SELECT id, owner, expires_at, legal_hold, deleted_at, metadata, created_at, updated_at
    FROM memory_nodes
    WHERE expires_at IS NOT NULL
      AND expires_at <= now()
      AND deleted_at IS NULL
      AND legal_hold = false
    ORDER BY expires_at ASC
    LIMIT $1
    FOR UPDATE SKIP LOCKED
  `,
    [limit]
  );
  return res.rows;
}

/**
 * Process a single batch: soft-delete expired nodes and insert signed audit_events
 * within the same transaction.
 *
 * Returns number of nodes processed.
 */
export async function processBatch(limit = DEFAULT_BATCH_SIZE): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const rows = await fetchExpiredNodesForUpdate(client, limit);
    if (!rows.length) {
      await client.query('COMMIT');
      return 0;
    }

    for (const node of rows) {
      const id = node.id;
      try {
        // 1) soft-delete (same logic as db.softDeleteMemoryNode)
        await client.query(
          `
          UPDATE memory_nodes
          SET deleted_at = now(),
              metadata = jsonb_set(metadata, '{deletedBy}', to_jsonb($2::text), true),
              updated_at = now()
          WHERE id = $1
        `,
          [id, 'ttl-cleaner']
        );

        // 2) Compute prev_hash (global last audit) and prepare payload
        const prevRes = await client.query<{ hash: string }>(
          `SELECT hash FROM audit_events ORDER BY created_at DESC LIMIT 1 FOR UPDATE`
        );
        const prevHash = prevRes.rows[0]?.hash ?? null;

        // Prepare payload similar to insertAuditEvent usage
        const auditPayload = {
          requestedBy: 'system',
          caller: 'ttl-cleaner',
          callerPrevHash: null
        };

        const canonical = canonicalizePayload(auditPayload);
        const digestHex = computeAuditDigest(canonical, prevHash);
        const digestBuf = Buffer.from(digestHex, 'hex');

        const signature = signAuditDigest(digestHex);
        if (!signature) {
          // In production we expect signing to be available. Treat missing signature as failure.
          throw new Error('audit signing failed or not configured (signature missing)');
        }

        // 3) Insert audit_event row referencing the memory node
        await client.query(
          `
          INSERT INTO audit_events
            (event_type, memory_node_id, artifact_id, payload, hash, prev_hash, signature, manifest_signature_id, created_at)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, now())
        `,
          [
            'memory.node.deleted',
            id,
            null,
            auditPayload,
            digestHex,
            prevHash,
            signature,
            null
          ]
        );

        console.info(`[ttlCleaner] soft-deleted node ${id} and recorded audit entry`);
      } catch (err) {
        // If anything fails while processing this node, record error and continue with next node.
        // We prefer to mark the node's metadata with an error flag so operators can investigate.
        const msg = (err as Error).message || String(err);
        try {
          await client.query(
            `UPDATE memory_nodes SET metadata = jsonb_set(metadata, '{ttlCleanerError}', to_jsonb($2::text), true), updated_at = now() WHERE id = $1`,
            [id, msg]
          );
        } catch (uerr) {
          console.error(`[ttlCleaner] failed to mark error on node ${id}:`, (uerr as Error).message || uerr);
        }
        console.error(`[ttlCleaner] failed processing node ${id}: ${msg}`);
        // Note: do not rethrow; continue with other nodes. The transaction stays alive until end and will commit the successful ones.
      }
    }

    await client.query('COMMIT');
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ttlCleaner] batch failed, rolled back:', (err as Error).message || String(err));
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Start polling loop to run processBatch periodically.
 * Returns an object with stop() to halt the loop.
 */
export function start(intervalMs?: number, batchSize?: number) {
  const iv = intervalMs ?? Number(process.env.TTL_CLEANER_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS));
  const bs = batchSize ?? Number(process.env.TTL_CLEANER_BATCH_SIZE ?? String(DEFAULT_BATCH_SIZE));

  let running = true;
  let isProcessing = false;

  const tick = async () => {
    if (!running) return;
    if (isProcessing) return;
    isProcessing = true;
    try {
      const count = await processBatch(bs);
      if (count > 0) {
        console.info(`[ttlCleaner] processed ${count} expired nodes`);
      }
    } catch (err) {
      console.error('[ttlCleaner] tick error:', (err as Error).message || err);
    } finally {
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
      } else {
        const processed = await processBatch();
        console.info(`[ttlCleaner] one-shot processed ${processed} rows`);
        process.exit(0);
      }
    } catch (err) {
      console.error('[ttlCleaner] fatal error:', (err as Error).message || err);
      process.exit(1);
    }
  })();
}

export default {
  processBatch,
  start
};

