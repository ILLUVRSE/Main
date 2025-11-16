"use strict";
/**
 * memory-layer/service/db.ts
 *
 * Postgres helpers for Memory Layer (finalized).
 *
 * - getPool / withClient
 * - CRUD helpers for memory_nodes, artifacts, memory_vectors, audit_events
 * - insertAuditEvent uses async signAuditDigest and enforces signing in prod/REQUIRE_KMS
 * - insertMemoryNodeWithAudit: transactional helper to insert node + artifacts + signed audit atomically
 *
 * Notes:
 *  - All TTL parameters are passed as integers (or null) and SQL uses explicit casts to avoid
 *    ambiguous type inference across different query contexts.
 *  - This file is careful to not mix textual interval constructions; it uses make_interval for TTL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withClient = exports.getPool = exports.setPool = void 0;
exports.insertMemoryNode = insertMemoryNode;
exports.updateMemoryNodeEmbedding = updateMemoryNodeEmbedding;
exports.getMemoryNodeById = getMemoryNodeById;
exports.setLegalHold = setLegalHold;
exports.softDeleteMemoryNode = softDeleteMemoryNode;
exports.insertArtifact = insertArtifact;
exports.getArtifactById = getArtifactById;
exports.getArtifactsByNodeId = getArtifactsByNodeId;
exports.getArtifactsForNodes = getArtifactsForNodes;
exports.insertAuditEvent = insertAuditEvent;
exports.getLatestAuditForMemoryNode = getLatestAuditForMemoryNode;
exports.getLatestAuditForArtifact = getLatestAuditForArtifact;
exports.findMemoryNodesByIds = findMemoryNodesByIds;
exports.insertMemoryNodeWithAudit = insertMemoryNodeWithAudit;
const pg_1 = require("pg");
const auditChain_1 = require("./audit/auditChain");
let pool = null;
const buildPool = () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not configured for Memory Layer');
    }
    return new pg_1.Pool({
        connectionString,
        max: Number(process.env.PG_POOL_MAX ?? 10),
        // keep default SSL behavior; operators can provide NODE_TLS_REJECT_UNAUTHORIZED or CA via env
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
    });
};
const setPool = (customPool) => {
    pool = customPool;
};
exports.setPool = setPool;
const getPool = () => {
    if (!pool)
        pool = buildPool();
    return pool;
};
exports.getPool = getPool;
const withClient = async (handler) => {
    const client = await (0, exports.getPool)().connect();
    try {
        return await handler(client);
    }
    finally {
        client.release();
    }
};
exports.withClient = withClient;
const parseJson = (value, fallback) => {
    if (value === null || value === undefined)
        return fallback;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        }
        catch {
            return fallback;
        }
    }
    if (typeof value === 'object') {
        return value;
    }
    return fallback;
};
const hydrateMemoryNode = (row) => ({
    ...row,
    metadata: parseJson(row.metadata, {}),
    pii_flags: parseJson(row.pii_flags, {})
});
const hydrateArtifact = (row) => ({
    ...row,
    metadata: parseJson(row.metadata, {})
});
/**
 * Create a memory node (simple helper).
 * Note: prefer insertMemoryNodeWithAudit for production flows that require an audit event atomically.
 */
async function insertMemoryNode(input) {
    const ttl = typeof input.ttlSeconds === 'number' ? Math.trunc(input.ttlSeconds) : null;
    const { rows } = await (0, exports.getPool)().query(`
    INSERT INTO memory_nodes (
      owner,
      embedding_id,
      metadata,
      pii_flags,
      legal_hold,
      ttl_seconds,
      expires_at
    )
    VALUES (
      $1,
      $2,
      COALESCE($3::jsonb, '{}'::jsonb),
      COALESCE($4::jsonb, '{}'::jsonb),
      COALESCE($5, FALSE),
      $6::int,
      CASE WHEN $6::int IS NULL THEN NULL ELSE now() + make_interval(secs => $6::int) END
    )
    RETURNING *
  `, [
        input.owner,
        input.embeddingId ?? null,
        JSON.stringify(input.metadata ?? {}),
        JSON.stringify(input.piiFlags ?? {}),
        input.legalHold ?? false,
        ttl
    ]);
    return hydrateMemoryNode(rows[0]);
}
async function updateMemoryNodeEmbedding(nodeId, embeddingId) {
    await (0, exports.getPool)().query(`
    UPDATE memory_nodes
    SET embedding_id = $2,
        updated_at = now()
    WHERE id = $1
  `, [nodeId, embeddingId]);
}
async function getMemoryNodeById(id) {
    const { rows } = await (0, exports.getPool)().query(`SELECT * FROM memory_nodes WHERE id = $1 AND deleted_at IS NULL`, [
        id
    ]);
    return rows[0] ? hydrateMemoryNode(rows[0]) : null;
}
async function setLegalHold(id, legalHold, reason) {
    await (0, exports.getPool)().query(`
    UPDATE memory_nodes
    SET legal_hold = $2,
        legal_hold_reason = $3,
        updated_at = now()
    WHERE id = $1
  `, [id, legalHold, reason ?? null]);
}
async function softDeleteMemoryNode(id, deletedBy) {
    await (0, exports.getPool)().query(`
    UPDATE memory_nodes
    SET deleted_at = now(),
        metadata = jsonb_set(metadata, '{deletedBy}', to_jsonb($2::text), true),
        updated_at = now()
    WHERE id = $1
  `, [id, deletedBy ?? 'system']);
}
async function insertArtifact(nodeId, artifact) {
    const { rows } = await (0, exports.getPool)().query(`
    INSERT INTO artifacts (
      memory_node_id,
      artifact_url,
      sha256,
      manifest_signature_id,
      size_bytes,
      created_by,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::jsonb, '{}'::jsonb))
    ON CONFLICT (artifact_url, sha256) DO UPDATE
    SET updated_at = now()
    RETURNING id
  `, [
        nodeId,
        artifact.artifactUrl,
        artifact.sha256,
        artifact.manifestSignatureId ?? null,
        artifact.sizeBytes ?? null,
        artifact.createdBy ?? null,
        JSON.stringify(artifact.metadata ?? {})
    ]);
    return rows[0]?.id;
}
async function getArtifactById(id) {
    const { rows } = await (0, exports.getPool)().query(`SELECT * FROM artifacts WHERE id = $1`, [id]);
    return rows[0] ? hydrateArtifact(rows[0]) : null;
}
async function getArtifactsByNodeId(nodeId) {
    const { rows } = await (0, exports.getPool)().query(`
    SELECT *
    FROM artifacts
    WHERE memory_node_id = $1
    ORDER BY created_at DESC
  `, [nodeId]);
    return rows.map(hydrateArtifact);
}
async function getArtifactsForNodes(nodeIds) {
    const result = new Map();
    if (!nodeIds.length)
        return result;
    // build placeholders and pass nodeIds as params
    const placeholders = nodeIds.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await (0, exports.getPool)().query(`SELECT * FROM artifacts WHERE memory_node_id IN (${placeholders})`, nodeIds);
    for (const raw of rows) {
        if (!raw.memory_node_id)
            continue;
        const row = hydrateArtifact(raw);
        const key = String(row.memory_node_id);
        const existing = result.get(key) ?? [];
        existing.push(row);
        result.set(key, existing);
    }
    return result;
}
/**
 * Insert an audit event. Ensures canonical digest & signs using configured signer (KMS/signing proxy/mock/local).
 * Enforces signing presence in production / REQUIRE_KMS.
 */
async function insertAuditEvent(input) {
    return (0, exports.withClient)(async (client) => {
        await client.query('BEGIN');
        try {
            const prevRes = await client.query(`SELECT hash FROM audit_events ORDER BY created_at DESC LIMIT 1 FOR UPDATE`);
            const prevHash = prevRes.rows[0]?.hash ?? null;
            const payload = {
                ...input.payload,
                callerPrevHash: input.callerPrevHash ?? null
            };
            const canonical = (0, auditChain_1.canonicalizePayload)(payload);
            const digest = (0, auditChain_1.computeAuditDigest)(canonical, prevHash);
            // Async signing
            let signature = null;
            try {
                signature = await (0, auditChain_1.signAuditDigest)(digest);
            }
            catch (err) {
                await client.query('ROLLBACK');
                throw new Error(`audit signing failed: ${err.message || String(err)}`);
            }
            const requireKms = String(process.env.REQUIRE_KMS ?? '').toLowerCase() === 'true';
            const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
            if (!signature && (requireKms || isProd)) {
                await client.query('ROLLBACK');
                throw new Error('audit signing required but no signature produced');
            }
            const insertRes = await client.query(`
        INSERT INTO audit_events (
          event_type,
          memory_node_id,
          artifact_id,
          payload,
          hash,
          prev_hash,
          signature,
          manifest_signature_id,
          created_at
        )
        VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,now())
        RETURNING id, hash, prev_hash, signature, manifest_signature_id, payload, created_at
      `, [
                input.eventType,
                input.memoryNodeId ?? null,
                input.artifactId ?? null,
                payload,
                digest,
                prevHash,
                signature,
                input.manifestSignatureId ?? null
            ]);
            await client.query('COMMIT');
            return insertRes.rows[0];
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
    });
}
async function getLatestAuditForMemoryNode(nodeId) {
    const { rows } = await (0, exports.getPool)().query(`
    SELECT id, hash, prev_hash, signature, manifest_signature_id, payload, created_at
    FROM audit_events
    WHERE memory_node_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [nodeId]);
    return rows[0] ?? null;
}
async function getLatestAuditForArtifact(artifactId) {
    const { rows } = await (0, exports.getPool)().query(`
    SELECT id, hash, prev_hash, signature, manifest_signature_id, payload, created_at
    FROM audit_events
    WHERE artifact_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [artifactId]);
    return rows[0] ?? null;
}
async function findMemoryNodesByIds(ids) {
    if (!ids.length)
        return [];
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await (0, exports.getPool)().query(`SELECT * FROM memory_nodes WHERE id IN (${placeholders}) AND deleted_at IS NULL`, ids);
    return rows.map(hydrateMemoryNode);
}
/**
 * Transactional helper to create a memory node + artifacts and a signed audit event atomically.
 * Returns { node, audit } where `node` is the inserted memory_nodes row, and `audit` is the audit_events row.
 */
async function insertMemoryNodeWithAudit(input, auditEventType, auditPayload, manifestSignatureId) {
    return (0, exports.withClient)(async (client) => {
        await client.query('BEGIN');
        try {
            const ttl = typeof input.ttlSeconds === 'number' ? Math.trunc(input.ttlSeconds) : null;
            const insertNodeRes = await client.query(`
        INSERT INTO memory_nodes (
          owner,
          embedding_id,
          metadata,
          pii_flags,
          legal_hold,
          ttl_seconds,
          expires_at
        )
        VALUES ($1,$2,COALESCE($3::jsonb,'{}'::jsonb),COALESCE($4::jsonb,'{}'::jsonb),COALESCE($5,FALSE),$6::int,
          CASE WHEN $6::int IS NULL THEN NULL ELSE now() + make_interval(secs => $6::int) END)
        RETURNING *
      `, [
                input.owner,
                input.embeddingId ?? null,
                JSON.stringify(input.metadata ?? {}),
                JSON.stringify(input.piiFlags ?? {}),
                input.legalHold ?? false,
                ttl
            ]);
            const node = hydrateMemoryNode(insertNodeRes.rows[0]);
            // Insert artifacts inline
            if (Array.isArray(input.artifacts) && input.artifacts.length) {
                for (const artifact of input.artifacts) {
                    await client.query(`
            INSERT INTO artifacts (
              memory_node_id,
              artifact_url,
              sha256,
              manifest_signature_id,
              size_bytes,
              created_by,
              metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::jsonb,'{}'::jsonb))
            ON CONFLICT (artifact_url, sha256) DO UPDATE
            SET updated_at = now()
            RETURNING id
          `, [
                        node.id,
                        artifact.artifactUrl,
                        artifact.sha256,
                        artifact.manifestSignatureId ?? null,
                        artifact.sizeBytes ?? null,
                        artifact.createdBy ?? null,
                        JSON.stringify(artifact.metadata ?? {})
                    ]);
                }
            }
            // Prepare audit: compute prev hash, digest, and sign
            const prevRes = await client.query(`SELECT hash FROM audit_events ORDER BY created_at DESC LIMIT 1 FOR UPDATE`);
            const prevHash = prevRes.rows[0]?.hash ?? null;
            const canonical = (0, auditChain_1.canonicalizePayload)(auditPayload);
            const digest = (0, auditChain_1.computeAuditDigest)(canonical, prevHash);
            let signature = null;
            try {
                signature = await (0, auditChain_1.signAuditDigest)(digest);
            }
            catch (err) {
                await client.query('ROLLBACK');
                throw new Error(`audit signing failed: ${err.message || String(err)}`);
            }
            const requireKms = String(process.env.REQUIRE_KMS ?? '').toLowerCase() === 'true';
            const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
            if (!signature && (requireKms || isProd)) {
                await client.query('ROLLBACK');
                throw new Error('audit signing required but no signature produced');
            }
            const insertAuditRes = await client.query(`
        INSERT INTO audit_events (
          event_type,
          memory_node_id,
          artifact_id,
          payload,
          hash,
          prev_hash,
          signature,
          manifest_signature_id,
          created_at
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, now())
        RETURNING id, hash, prev_hash, signature, manifest_signature_id, payload, created_at
      `, [auditEventType, node.id, null, auditPayload, digest, prevHash, signature, manifestSignatureId ?? null]);
            await client.query('COMMIT');
            return { node, audit: insertAuditRes.rows[0] };
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
    });
}
