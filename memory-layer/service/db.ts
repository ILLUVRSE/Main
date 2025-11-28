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

import { Pool, PoolClient } from 'pg';
import {
  canonicalizePayload,
  computeAuditDigest,
  signAuditDigest
} from './audit/auditChain';
import type {
  ArtifactInput,
  ArtifactRecord,
  AuditEventRecord,
  MemoryNodeInput,
  MemoryNodeRecord
} from './types';

let pool: Pool | null = null;

const buildPool = (): Pool => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured for Memory Layer');
  }
  return new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    // keep default SSL behavior; operators can provide NODE_TLS_REJECT_UNAUTHORIZED or CA via env
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
  });
};

export const setPool = (customPool: Pool | null) => {
  pool = customPool;
};

export const getPool = (): Pool => {
  if (!pool) pool = buildPool();
  return pool;
};

export const withClient = async <T>(handler: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await getPool().connect();
  try {
    return await handler(client);
  } finally {
    client.release();
  }
};

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  if (typeof value === 'object') {
    return value as T;
  }
  return fallback;
};

const hydrateMemoryNode = (row: any): MemoryNodeRecord => ({
  ...row,
  metadata: parseJson(row.metadata, {}),
  pii_flags: parseJson(row.pii_flags, {})
});

const hydrateArtifact = (row: any): ArtifactRecord => ({
  ...row,
  metadata: parseJson(row.metadata, {})
});

/**
 * Create a memory node (simple helper).
 * Note: prefer insertMemoryNodeWithAudit for production flows that require an audit event atomically.
 */
export async function insertMemoryNode(input: MemoryNodeInput): Promise<MemoryNodeRecord> {
  const ttl = typeof input.ttlSeconds === 'number' ? Math.trunc(input.ttlSeconds) : null;
  const { rows } = await getPool().query<MemoryNodeRecord>(
    `
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
  `,
    [
      input.owner,
      input.embeddingId ?? null,
      JSON.stringify(input.metadata ?? {}),
      JSON.stringify(input.piiFlags ?? {}),
      input.legalHold ?? false,
      ttl
    ]
  );

  return hydrateMemoryNode(rows[0]);
}

export async function updateMemoryNodeEmbedding(nodeId: string, embeddingId: string): Promise<void> {
  await getPool().query(
    `
    UPDATE memory_nodes
    SET embedding_id = $2,
        updated_at = now()
    WHERE id = $1
  `,
    [nodeId, embeddingId]
  );
}

export async function getMemoryNodeById(id: string): Promise<MemoryNodeRecord | null> {
  const { rows } = await getPool().query<MemoryNodeRecord>(`SELECT * FROM memory_nodes WHERE id = $1 AND deleted_at IS NULL`, [
    id
  ]);
  return rows[0] ? hydrateMemoryNode(rows[0]) : null;
}

export async function setLegalHold(id: string, legalHold: boolean, reason?: string): Promise<void> {
  await getPool().query(
    `
    UPDATE memory_nodes
    SET legal_hold = $2,
        legal_hold_reason = $3,
        updated_at = now()
    WHERE id = $1
  `,
    [id, legalHold, reason ?? null]
  );
}

export async function softDeleteMemoryNode(id: string, deletedBy?: string): Promise<void> {
  await getPool().query(
    `
    UPDATE memory_nodes
    SET deleted_at = now(),
        metadata = jsonb_set(metadata, '{deletedBy}', to_jsonb($2::text), true),
        updated_at = now()
    WHERE id = $1
  `,
    [id, deletedBy ?? 'system']
  );
}

export async function insertArtifact(nodeId: string | null, artifact: ArtifactInput): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `
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
  `,
    [
      nodeId,
      artifact.artifactUrl,
      artifact.sha256,
      artifact.manifestSignatureId ?? null,
      artifact.sizeBytes ?? null,
      artifact.createdBy ?? null,
      JSON.stringify(artifact.metadata ?? {})
    ]
  );

  return rows[0]?.id;
}

export async function getArtifactById(id: string): Promise<ArtifactRecord | null> {
  const { rows } = await getPool().query<ArtifactRecord>(`SELECT * FROM artifacts WHERE id = $1`, [id]);
  return rows[0] ? hydrateArtifact(rows[0]) : null;
}

export async function getArtifactsByNodeId(nodeId: string): Promise<ArtifactRecord[]> {
  const { rows } = await getPool().query<ArtifactRecord>(
    `
    SELECT *
    FROM artifacts
    WHERE memory_node_id = $1
    ORDER BY created_at DESC
  `,
    [nodeId]
  );
  return rows.map(hydrateArtifact);
}

export async function getArtifactsForNodes(nodeIds: string[]): Promise<Map<string, ArtifactRecord[]>> {
  const result = new Map<string, ArtifactRecord[]>();
  if (!nodeIds.length) return result;
  // build placeholders and pass nodeIds as params
  const placeholders = nodeIds.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await getPool().query<any>(`SELECT * FROM artifacts WHERE memory_node_id IN (${placeholders})`, nodeIds);
  for (const raw of rows) {
    if (!raw.memory_node_id) continue;
    const row = hydrateArtifact(raw);
    const key = String(row.memory_node_id);
    const existing = result.get(key) ?? [];
    existing.push(row);
    result.set(key, existing);
  }
  return result;
}

interface AuditEventInput {
  eventType: string;
  memoryNodeId?: string | null;
  artifactId?: string | null;
  payload: Record<string, unknown>;
  manifestSignatureId?: string | null;
  callerPrevHash?: string | null;
}

/**
 * Insert an audit event. Ensures canonical digest & signs using configured signer (KMS/signing proxy/mock/local).
 * Enforces signing presence in production / REQUIRE_KMS.
 */
export async function insertAuditEvent(input: AuditEventInput): Promise<AuditEventRecord> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const prevRes = await client.query<{ hash: string }>(`SELECT hash FROM audit_events ORDER BY created_at DESC LIMIT 1 FOR UPDATE`);
      const prevHash = prevRes.rows[0]?.hash ?? null;

      const payload = {
        ...input.payload,
        callerPrevHash: input.callerPrevHash ?? null
      };

      const canonical = canonicalizePayload(payload);
      const digest = computeAuditDigest(canonical, prevHash);

      // Async signing
      let signature: string | null = null;
      try {
        signature = await signAuditDigest(digest);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`audit signing failed: ${(err as Error).message || String(err)}`);
      }

      const requireKms = String(process.env.REQUIRE_KMS ?? '').toLowerCase() === 'true';
      const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
      if (!signature && (requireKms || isProd)) {
        await client.query('ROLLBACK');
        throw new Error('audit signing required but no signature produced');
      }

      const insertRes = await client.query<AuditEventRecord>(
        `
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
      `,
        [
          input.eventType,
          input.memoryNodeId ?? null,
          input.artifactId ?? null,
          payload,
          digest,
          prevHash,
          signature,
          input.manifestSignatureId ?? null
        ]
      );

      await client.query('COMMIT');
      return insertRes.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

export async function getLatestAuditForMemoryNode(nodeId: string): Promise<AuditEventRecord | null> {
  const { rows } = await getPool().query<AuditEventRecord>(
    `
    SELECT id, hash, prev_hash, signature, manifest_signature_id, payload, created_at
    FROM audit_events
    WHERE memory_node_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `,
    [nodeId]
  );
  return rows[0] ?? null;
}

export async function getLatestAuditForArtifact(artifactId: string): Promise<AuditEventRecord | null> {
  const { rows } = await getPool().query<AuditEventRecord>(
    `
    SELECT id, hash, prev_hash, signature, manifest_signature_id, payload, created_at
    FROM audit_events
    WHERE artifact_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `,
    [artifactId]
  );
  return rows[0] ?? null;
}

export async function findMemoryNodesByIds(ids: string[]): Promise<MemoryNodeRecord[]> {
  if (!ids.length) return [];
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await getPool().query<MemoryNodeRecord>(`SELECT * FROM memory_nodes WHERE id IN (${placeholders}) AND deleted_at IS NULL`, ids);
  return rows.map(hydrateMemoryNode);
}

/**
 * Transactional helper to create a memory node + artifacts and a signed audit event atomically.
 * Returns { node, audit } where `node` is the inserted memory_nodes row, and `audit` is the audit_events row.
 */
export async function insertMemoryNodeWithAudit(
  input: MemoryNodeInput,
  auditEventType: string,
  auditPayload: Record<string, unknown>,
  manifestSignatureId?: string | null
): Promise<{ node: MemoryNodeRecord; audit: AuditEventRecord }> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const ttl = typeof input.ttlSeconds === 'number' ? Math.trunc(input.ttlSeconds) : null;

      const insertNodeRes = await client.query<MemoryNodeRecord>(
        `
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
          CASE WHEN $6::int IS NULL THEN NULL ELSE now() + make_interval(0,0,0,0,0,0,$6::int) END)
        RETURNING *
      `,
        [
          input.owner,
          input.embeddingId ?? null,
          JSON.stringify(input.metadata ?? {}),
          JSON.stringify(input.piiFlags ?? {}),
          input.legalHold ?? false,
          ttl
        ]
      );

      const node = hydrateMemoryNode(insertNodeRes.rows[0]);

      // Insert vector queue item if embedding is present (Atomicity for Vector Writes)
      if (input.embedding) {
        const provider = process.env.VECTOR_DB_PROVIDER ?? 'postgres';
        const namespace = process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory';
        const embedding = input.embedding;
        await client.query(
          `
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
                  error = NULL,
                  updated_at = now()
          `,
          [
            node.id,
            provider,
            namespace,
            embedding.model,
            embedding.dimension ?? (Array.isArray(embedding.vector) ? embedding.vector.length : null),
            input.embeddingId ?? null,
            'pending', // Status is pending, worker will pick it up
            null,
            JSON.stringify(embedding.vector ?? []),
            JSON.stringify({
              owner: node.owner,
              metadata: node.metadata,
              piiFlags: node.pii_flags
            })
          ]
        );
      }

      // Insert Reasoning Graph queue item (Atomicity for Reasoning Graph)
      // We push a job to notify Reasoning Graph about the new memory node
      const reasonPayload = {
        memoryNodeId: node.id,
        owner: node.owner,
        metadata: node.metadata,
        timestamp: new Date().toISOString()
      };

      await client.query(
        `
        INSERT INTO reasoning_graph_queue (
          memory_node_id,
          status,
          payload,
          created_at,
          updated_at
        ) VALUES ($1, 'pending', $2::jsonb, now(), now())
        `,
        [node.id, JSON.stringify(reasonPayload)]
      );

      // Insert artifacts inline
      if (Array.isArray(input.artifacts) && input.artifacts.length) {
        for (const artifact of input.artifacts) {
          await client.query(
            `
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
          `,
            [
              node.id,
              artifact.artifactUrl,
              artifact.sha256,
              artifact.manifestSignatureId ?? null,
              artifact.sizeBytes ?? null,
              artifact.createdBy ?? null,
              JSON.stringify(artifact.metadata ?? {})
            ]
          );
        }
      }

      // Prepare audit: compute prev hash, digest, and sign
      const prevRes = await client.query<{ hash: string }>(`SELECT hash FROM audit_events ORDER BY created_at DESC LIMIT 1 FOR UPDATE`);
      const prevHash = prevRes.rows[0]?.hash ?? null;

      const canonical = canonicalizePayload(auditPayload);
      const digest = computeAuditDigest(canonical, prevHash);

      let signature: string | null = null;
      try {
        signature = await signAuditDigest(digest);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`audit signing failed: ${(err as Error).message || String(err)}`);
      }

      const requireKms = String(process.env.REQUIRE_KMS ?? '').toLowerCase() === 'true';
      const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
      if (!signature && (requireKms || isProd)) {
        await client.query('ROLLBACK');
        throw new Error('audit signing required but no signature produced');
      }

      const insertAuditRes = await client.query<AuditEventRecord>(
        `
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
      `,
        [auditEventType, node.id, null, auditPayload, digest, prevHash, signature, manifestSignatureId ?? null]
      );

      await client.query('COMMIT');
      return { node, audit: insertAuditRes.rows[0] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

