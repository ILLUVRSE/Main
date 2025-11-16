"use strict";
/**
 * memory-layer/service/services/memoryService.ts
 *
 * MemoryService implementation with observability (metrics + tracing) enhancements.
 *
 * - Uses insertMemoryNodeWithAudit(...) to atomically persist node+artifacts+audit.
 * - Validates artifact checksums via s3Client before DB insert.
 * - Performs vector upserts after DB commit; if upsert fails, writes a pending memory_vectors row for worker replay.
 * - Emits metrics (ingest, vector write, audit failures) and attaches trace metadata to audit payloads.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemoryService = void 0;
const db_1 = require("../db");
const s3Client_1 = __importDefault(require("../storage/s3Client"));
// Observability
const metrics_1 = __importDefault(require("../observability/metrics"));
const tracing_1 = __importDefault(require("../observability/tracing"));
const MIN_TTL_SECONDS = 3600;
const SHA256_REGEX = /^[a-f0-9]{64}$/i;
const ensureOwner = (input) => {
    if (!input.owner) {
        throw new Error('owner is required.');
    }
};
const ensureTtl = (input) => {
    if (input.ttlSeconds != null && input.ttlSeconds < MIN_TTL_SECONDS) {
        throw new Error(`ttlSeconds must be >= ${MIN_TTL_SECONDS}`);
    }
};
const ensureMetadataDefaults = (input) => ({
    ...input,
    metadata: input.metadata ?? {},
    piiFlags: input.piiFlags ?? {}
});
const ensureArtifactValidity = (artifact) => {
    if (!artifact.artifactUrl || !artifact.sha256) {
        throw new Error('artifactUrl and sha256 are required.');
    }
    if (!SHA256_REGEX.test(artifact.sha256)) {
        throw new Error('sha256 must be a 64-character hex string.');
    }
    if (!artifact.manifestSignatureId) {
        throw new Error('manifestSignatureId is required for artifact writes.');
    }
};
const toMemoryNodeView = (node, artifacts, latestAudit) => ({
    memoryNodeId: node.id,
    owner: node.owner,
    embeddingId: node.embedding_id,
    metadata: node.metadata ?? {},
    piiFlags: node.pii_flags ?? {},
    legalHold: node.legal_hold,
    ttlSeconds: node.ttl_seconds,
    expiresAt: node.expires_at,
    artifacts,
    latestAudit
});
const extractValue = (node, path) => {
    const [root, ...rest] = path.split('.');
    const source = {
        owner: node.owner,
        metadata: node.metadata ?? {},
        piiFlags: node.pii_flags ?? {},
        legalHold: node.legal_hold,
        ttlSeconds: node.ttl_seconds
    };
    let current = root ? source[root] : undefined;
    for (const key of rest) {
        if (current && typeof current === 'object') {
            current = current[key];
        }
        else {
            current = undefined;
            break;
        }
    }
    return current;
};
const matchesFilter = (node, filter) => {
    if (!filter)
        return true;
    return Object.entries(filter).every(([path, expected]) => {
        const actual = extractValue(node, path);
        if (Array.isArray(expected)) {
            return expected.some((value) => value === actual);
        }
        return expected === actual;
    });
};
const createMemoryService = (deps) => ({
    /**
     * Create a MemoryNode:
     *  - validate artifacts (checksum) before DB insert
     *  - call insertMemoryNodeWithAudit to persist node + artifacts + audit atomically
     *  - asynchronously attempt vector upsert; on failure insert memory_vectors row for worker replay
     */
    async createMemoryNode(rawInput, ctx) {
        ensureOwner(rawInput);
        ensureTtl(rawInput);
        const input = ensureMetadataDefaults(rawInput);
        // Metrics: ingestion attempt
        try {
            metrics_1.default.metrics.ingestion.inc({ owner: input.owner, result: 'started' });
        }
        catch {
            // ignore metrics failures
        }
        // Validate artifacts' checksum before DB transaction
        if (input.artifacts?.length) {
            for (const artifact of input.artifacts) {
                ensureArtifactValidity(artifact);
                // Validate checksum by streaming S3/HTTP
                try {
                    const ok = await s3Client_1.default.validateArtifactChecksum(artifact.artifactUrl, artifact.sha256);
                    if (!ok) {
                        throw new Error(`checksum mismatch for ${artifact.artifactUrl}`);
                    }
                }
                catch (err) {
                    // Record metric for failure
                    try {
                        metrics_1.default.metrics.ingestion.inc({ owner: input.owner, result: 'artifact_validation_failed' });
                    }
                    catch { }
                    throw new Error(`artifact validation failed for ${artifact.artifactUrl}: ${err.message || err}`);
                }
            }
        }
        // Build audit payload and inject tracing info
        let auditPayload = {
            owner: input.owner,
            metadata: input.metadata ?? {},
            caller: ctx.caller ?? 'unknown'
        };
        try {
            auditPayload = tracing_1.default.injectTraceIntoAuditPayload(auditPayload);
        }
        catch {
            // ignore tracing issues
        }
        // Insert node + artifacts + audit atomically
        let node;
        let audit;
        try {
            const res = await (0, db_1.insertMemoryNodeWithAudit)(input, 'memory.node.created', auditPayload, ctx.manifestSignatureId ?? null);
            node = res.node;
            audit = res.audit;
        }
        catch (err) {
            // Record audit sign failure metric if signing failed
            const msg = err.message || String(err);
            try {
                if (msg.toLowerCase().includes('audit signing failed') || msg.toLowerCase().includes('audit signing required')) {
                    metrics_1.default.metrics.audit.failure({ reason: 'signing_failed' });
                }
                else {
                    metrics_1.default.metrics.audit.failure({ reason: 'insert_failed' });
                }
            }
            catch {
                // ignore
            }
            // propagate error
            throw err;
        }
        // Record memory node created metric
        try {
            metrics_1.default.metrics.memoryNode.created({ owner: node.owner });
            metrics_1.default.metrics.ingestion.inc({ owner: node.owner, result: 'succeeded' });
        }
        catch {
            // ignore metrics failures
        }
        // After commit: attempt vector upsert (async). We do not block the API response on vector DB.
        let vectorRef = null;
        if (input.embedding) {
            // measure vector upsert duration
            const start = Date.now();
            try {
                const vectorResponse = await deps.vectorAdapter.upsertEmbedding({
                    memoryNodeId: node.id,
                    embeddingId: input.embeddingId ?? node.embedding_id,
                    embedding: { model: input.embedding.model, dimension: input.embedding.dimension ?? undefined, vector: input.embedding.vector, namespace: process.env.VECTOR_DB_NAMESPACE ?? "kernel-memory" },
                    metadata: {
                        owner: node.owner,
                        metadata: node.metadata,
                        piiFlags: node.pii_flags
                    }
                });
                const elapsed = (Date.now() - start) / 1000.0;
                // metrics
                try {
                    metrics_1.default.metrics.vectorWrite.observe({ provider: process.env.VECTOR_DB_PROVIDER ?? 'postgres', namespace: process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory', owner: node.owner }, elapsed);
                }
                catch { }
                if (vectorResponse.externalVectorId) {
                    // persist external vector id on memory_nodes
                    await (0, db_1.updateMemoryNodeEmbedding)(node.id, vectorResponse.externalVectorId);
                    vectorRef = vectorResponse.externalVectorId ?? null;
                }
                try {
                    metrics_1.default.metrics.vectorWrite.success({ provider: process.env.VECTOR_DB_PROVIDER ?? 'postgres', namespace: process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory' });
                }
                catch { }
            }
            catch (err) {
                // Adapter failed — insert a pending memory_vectors row so worker can retry.
                const elapsed = (Date.now() - start) / 1000.0;
                try {
                    metrics_1.default.metrics.vectorWrite.failure({ provider: process.env.VECTOR_DB_PROVIDER ?? 'postgres', namespace: process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory', error: err.message ?? 'adapter_error' });
                    metrics_1.default.metrics.vectorWrite.observe({ provider: process.env.VECTOR_DB_PROVIDER ?? 'postgres', namespace: process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory', owner: node.owner }, elapsed);
                }
                catch { }
                console.error(`[memoryService] vector upsert failed for node ${node.id}:`, err.message || err);
                try {
                    const pool = (0, db_1.getPool)();
                    const provider = process.env.VECTOR_DB_PROVIDER ?? 'postgres';
                    const namespace = process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory';
                    const embedding = input.embedding;
                    // write vector_data as JSONB, status 'pending' so worker will pick it up
                    await pool.query(`
            INSERT INTO memory_vectors (
              memory_node_id,
              provider,
              namespace,
              embedding_model,
              dimension,
              external_vector_id,
              status,
              error,
              vector_data,
              metadata,
              created_at,
              updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,now(),now())
            ON CONFLICT (memory_node_id, namespace) DO UPDATE
              SET vector_data = EXCLUDED.vector_data,
                  embedding_model = EXCLUDED.embedding_model,
                  dimension = EXCLUDED.dimension,
                  external_vector_id = EXCLUDED.external_vector_id,
                  status = 'pending',
                  error = EXCLUDED.error,
                  updated_at = now()
          `, [
                        node.id,
                        provider,
                        namespace,
                        embedding.model,
                        embedding.dimension ?? (Array.isArray(embedding.vector) ? embedding.vector.length : null),
                        input.embeddingId ?? null,
                        'pending',
                        err.message ?? 'adapter_error',
                        JSON.stringify(embedding.vector ?? []),
                        JSON.stringify({
                            owner: node.owner,
                            metadata: node.metadata,
                            piiFlags: node.pii_flags
                        })
                    ]);
                    // Update vector queue depth metric (approx)
                    try {
                        const qRes = await pool.query(`SELECT count(1) AS count FROM memory_vectors WHERE status = 'pending' AND namespace = $1`, [namespace]);
                        const depth = Number(qRes.rows[0]?.count ?? 0);
                        metrics_1.default.metrics.vectorQueue.setDepth(depth, { provider, namespace });
                    }
                    catch {
                        // ignore
                    }
                }
                catch (uerr) {
                    console.error('[memoryService] failed to enqueue vector for retry:', uerr.message || uerr);
                    try {
                        metrics_1.default.metrics.vectorQueue.workerError(uerr.message ?? 'enqueue_failed');
                    }
                    catch { }
                }
            }
        }
        return {
            memoryNodeId: node.id,
            embeddingVectorId: vectorRef,
            auditEventId: audit.id
        };
    },
    async getMemoryNode(id) {
        const node = await (0, db_1.getMemoryNodeById)(id);
        if (!node)
            return null;
        const artifacts = await (0, db_1.getArtifactsByNodeId)(id);
        const latestAudit = await (0, db_1.getLatestAuditForMemoryNode)(id);
        return toMemoryNodeView(node, artifacts.map((artifact) => ({
            artifactId: artifact.id,
            artifactUrl: artifact.artifact_url,
            sha256: artifact.sha256,
            manifestSignatureId: artifact.manifest_signature_id,
            sizeBytes: artifact.size_bytes ?? null
        })), latestAudit
            ? {
                auditEventId: latestAudit.id,
                hash: latestAudit.hash,
                createdAt: latestAudit.created_at
            }
            : undefined);
    },
    async getArtifact(id) {
        const artifact = await (0, db_1.getArtifactById)(id);
        if (!artifact)
            return null;
        const latestAudit = await (0, db_1.getLatestAuditForArtifact)(id);
        return {
            artifactId: artifact.id,
            artifactUrl: artifact.artifact_url,
            sha256: artifact.sha256,
            manifestSignatureId: artifact.manifest_signature_id ?? null,
            sizeBytes: artifact.size_bytes ?? null,
            createdAt: artifact.created_at,
            metadata: artifact.metadata,
            latestAudit: latestAudit ? { auditEventId: latestAudit.id, hash: latestAudit.hash, createdAt: latestAudit.created_at } : undefined
        };
    },
    async createArtifact(nodeId, artifact, ctx) {
        ensureArtifactValidity(artifact);
        // Validate checksum before persisting artifact metadata
        try {
            const ok = await s3Client_1.default.validateArtifactChecksum(artifact.artifactUrl, artifact.sha256);
            if (!ok) {
                try {
                    metrics_1.default.metrics.ingestion.inc({ owner: artifact.createdBy ?? 'unknown', result: 'artifact_validation_failed' });
                }
                catch { }
                throw new Error('checksum mismatch');
            }
        }
        catch (err) {
            throw new Error(`artifact checksum validation failed: ${err.message || err}`);
        }
        const artifactId = await (0, db_1.insertArtifact)(nodeId, artifact);
        if (!artifactId) {
            try {
                metrics_1.default.metrics.ingestion.inc({ owner: artifact.createdBy ?? 'unknown', result: 'artifact_persist_failed' });
            }
            catch { }
            throw new Error('failed to persist artifact metadata');
        }
        // Attach trace info to audit payload
        let auditPayload = {
            artifactUrl: artifact.artifactUrl,
            sha256: artifact.sha256,
            caller: ctx.caller ?? 'unknown'
        };
        try {
            auditPayload = tracing_1.default.injectTraceIntoAuditPayload(auditPayload);
        }
        catch {
            // ignore
        }
        const auditEvent = await (0, db_1.insertAuditEvent)({
            eventType: 'memory.artifact.created',
            memoryNodeId: nodeId,
            artifactId,
            payload: auditPayload,
            manifestSignatureId: artifact.manifestSignatureId ?? ctx.manifestSignatureId,
            callerPrevHash: ctx.prevAuditHash
        }).catch((err) => {
            try {
                metrics_1.default.metrics.audit.failure({ reason: 'artifact_audit_failed' });
            }
            catch { }
            throw err;
        });
        return { artifactId, auditEventId: auditEvent.id };
    },
    async searchMemoryNodes(request) {
        const start = Date.now();
        const vectorResults = await deps.vectorAdapter.search({ queryEmbedding: request.queryEmbedding, topK: request.topK, namespace: request.namespace, scoreThreshold: request.scoreThreshold ?? undefined });
        const elapsed = (Date.now() - start) / 1000.0;
        try {
            metrics_1.default.metrics.search.observe({ namespace: request.namespace ?? process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory' }, elapsed);
        }
        catch { }
        if (!vectorResults.length) {
            return [];
        }
        const ids = vectorResults.map((result) => result.memoryNodeId);
        const nodes = await (0, db_1.findMemoryNodesByIds)(ids);
        const nodeMap = new Map(nodes.map((node) => [node.id, node]));
        const filteredResults = vectorResults.filter((result) => {
            const node = nodeMap.get(result.memoryNodeId);
            return node ? matchesFilter(node, request.filter ?? undefined) : false;
        });
        if (!filteredResults.length)
            return [];
        const artifactsMap = await (0, db_1.getArtifactsForNodes)(filteredResults.map((result) => result.memoryNodeId));
        return filteredResults.map((result) => {
            const node = nodeMap.get(result.memoryNodeId);
            const artifactIds = (artifactsMap.get(result.memoryNodeId) ?? []).map((artifact) => artifact.id);
            return {
                memoryNodeId: result.memoryNodeId,
                score: result.score,
                metadata: node?.metadata ?? result.metadata ?? {},
                artifactIds,
                vectorRef: result.vectorRef ?? null
            };
        });
    },
    async setLegalHold(id, legalHold, reason, ctx) {
        const node = await (0, db_1.getMemoryNodeById)(id);
        if (!node) {
            throw new Error('memory node not found.');
        }
        await (0, db_1.setLegalHold)(id, legalHold, reason);
        // Attach trace to payload
        let payload = {
            legalHold,
            reason,
            caller: ctx.caller ?? 'unknown'
        };
        try {
            payload = tracing_1.default.injectTraceIntoAuditPayload(payload);
        }
        catch { }
        await (0, db_1.insertAuditEvent)({
            eventType: 'memory.node.legal_hold.updated',
            memoryNodeId: id,
            payload,
            callerPrevHash: ctx.prevAuditHash,
            manifestSignatureId: ctx.manifestSignatureId
        }).catch((err) => {
            try {
                metrics_1.default.metrics.audit.failure({ reason: 'legal_hold_audit_failed' });
            }
            catch { }
            throw err;
        });
    },
    async deleteMemoryNode(id, requestedBy, ctx) {
        const node = await (0, db_1.getMemoryNodeById)(id);
        if (!node) {
            throw new Error('memory node not found.');
        }
        if (node.legal_hold) {
            throw new Error('cannot delete node under legal hold.');
        }
        await (0, db_1.softDeleteMemoryNode)(id, requestedBy);
        // Build audit payload and attach trace
        let auditPayload = {
            requestedBy,
            caller: ctx.caller ?? 'unknown'
        };
        try {
            auditPayload = tracing_1.default.injectTraceIntoAuditPayload(auditPayload);
        }
        catch { }
        await (0, db_1.insertAuditEvent)({
            eventType: 'memory.node.deleted',
            memoryNodeId: id,
            payload: auditPayload,
            callerPrevHash: ctx.prevAuditHash,
            manifestSignatureId: ctx.manifestSignatureId
        }).catch((err) => {
            try {
                metrics_1.default.metrics.memoryNode.deleted({ owner: node.owner, reason: 'delete_failed' });
            }
            catch { }
            throw err;
        });
        // Record metric for deletion
        try {
            metrics_1.default.metrics.memoryNode.deleted({ owner: node.owner, reason: 'manual' });
        }
        catch { }
    }
});
exports.createMemoryService = createMemoryService;
exports.default = exports.createMemoryService;
