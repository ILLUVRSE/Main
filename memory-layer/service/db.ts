import { Pool } from 'pg';
import crypto from 'node:crypto';
import { ArtifactInput, MemoryNodeInput, MemoryNodeRecord } from './types';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

export const getPool = () => pool;

export async function insertMemoryNode(input: MemoryNodeInput): Promise<MemoryNodeRecord> {
  const ttl = input.ttlSeconds ?? null;
  const { rows } = await pool.query<MemoryNodeRecord>(
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
        $6,
        CASE
          WHEN $6 IS NULL THEN NULL
          ELSE now() + ($6::text || ' seconds')::interval
        END
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

  return rows[0];
}

export async function getMemoryNodeById(id: string): Promise<MemoryNodeRecord | null> {
  const { rows } = await pool.query<MemoryNodeRecord>(
    `SELECT * FROM memory_nodes WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

export async function setLegalHold(id: string, legalHold: boolean, reason?: string): Promise<void> {
  await pool.query(
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
  await pool.query(
    `
      UPDATE memory_nodes
      SET deleted_at = now(),
          metadata = jsonb_set(metadata, '{deletedBy}', to_jsonb($2::text), true)
      WHERE id = $1
    `,
    [id, deletedBy ?? 'system']
  );
}

export async function insertArtifact(nodeId: string | null, artifact: ArtifactInput): Promise<string> {
  const { rows } = await pool.query(
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

interface AuditEventInput {
  eventType: string;
  memoryNodeId?: string | null;
  artifactId?: string | null;
  payload: Record<string, unknown>;
  manifestSignatureId?: string;
  prevHash?: string;
  signature?: string;
}

export async function insertAuditEvent(input: AuditEventInput): Promise<string> {
  const payloadStr = JSON.stringify(input.payload ?? {});
  const hash = crypto.createHash('sha256').update(payloadStr).digest('hex');
  const { rows } = await pool.query<{ id: string }>(
    `
      INSERT INTO audit_events (
        event_type,
        memory_node_id,
        artifact_id,
        payload,
        hash,
        prev_hash,
        signature,
        manifest_signature_id
      )
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
      RETURNING id
    `,
    [
      input.eventType,
      input.memoryNodeId ?? null,
      input.artifactId ?? null,
      payloadStr,
      hash,
      input.prevHash ?? null,
      input.signature ?? null,
      input.manifestSignatureId ?? null
    ]
  );

  return rows[0]?.id;
}

export async function findMemoryNodesByIds(ids: string[]): Promise<MemoryNodeRecord[]> {
  if (!ids.length) return [];
  const { rows } = await pool.query<MemoryNodeRecord>(
    `SELECT * FROM memory_nodes WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [ids]
  );
  return rows;
}
