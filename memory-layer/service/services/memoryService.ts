/**
 * memory-layer/service/services/memoryService.ts
 *
 * MemoryService implementation (final).
 *
 * - Validates artifact checksums using s3Client (v3 wrapper).
 * - Persists node + artifacts + audit atomically via db.insertMemoryNodeWithAudit.
 * - Attempts vector upsert after DB commit; on failure enqueues pending memory_vectors row.
 * - Provides getMemoryNode, createArtifact, setLegalHold, deleteMemoryNode, searchMemoryNodes.
 */

import {
  findMemoryNodesByIds,
  getArtifactById,
  getArtifactsByNodeId,
  getArtifactsForNodes,
  getLatestAuditForArtifact,
  getLatestAuditForMemoryNode,
  getMemoryNodeById,
  insertArtifact,
  insertAuditEvent,
  setLegalHold as setLegalHoldDb,
  softDeleteMemoryNode,
  updateMemoryNodeEmbedding,
  insertMemoryNodeWithAudit,
  getPool
} from '../db';
import { VectorDbAdapter } from '../vector/vectorDbAdapter';
import s3Client from '../storage/s3Client';
import type {
  ArtifactInput,
  ArtifactView,
  AuditContext,
  MemoryNodeInput,
  MemoryNodeRecord,
  MemoryNodeView,
  SearchRequest,
  SearchResult
} from '../types';

export interface MemoryServiceDeps {
  vectorAdapter: VectorDbAdapter;
}

const MIN_TTL_SECONDS = 60; // lower bound for tests; production may require larger
const SHA256_REGEX = /^[a-f0-9]{64}$/i;

function ensureOwner(input: MemoryNodeInput) {
  if (!input.owner) throw new Error('owner is required');
}

function ensureTtl(input: MemoryNodeInput) {
  if (input.ttlSeconds != null && input.ttlSeconds < MIN_TTL_SECONDS) {
    throw new Error(`ttlSeconds must be >= ${MIN_TTL_SECONDS}`);
  }
}

function ensureArtifactValidity(artifact: ArtifactInput) {
  if (!artifact.artifactUrl || !artifact.sha256) {
    throw new Error('artifactUrl and sha256 are required');
  }
  if (!SHA256_REGEX.test(artifact.sha256)) {
    throw new Error('sha256 must be a 64-character hex string');
  }
  if (!artifact.manifestSignatureId) {
    throw new Error('manifestSignatureId is required for artifact writes');
  }
}

const toMemoryNodeView = (
  node: MemoryNodeRecord,
  artifacts: MemoryNodeView['artifacts'],
  latestAudit?: { auditEventId: string; hash: string; createdAt: string }
): MemoryNodeView => ({
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

export const createMemoryService = (deps: MemoryServiceDeps) => ({
  /**
   * Create a MemoryNode:
   *  - validate artifacts (checksum) before DB insert
   *  - call insertMemoryNodeWithAudit to persist node + artifacts + audit atomically
   *  - asynchronously attempt vector upsert; on failure insert memory_vectors row for worker retry
   */
  async createMemoryNode(rawInput: MemoryNodeInput, ctx: AuditContext) {
    ensureOwner(rawInput);
    ensureTtl(rawInput);
    const input: MemoryNodeInput = {
      ...rawInput,
      metadata: rawInput.metadata ?? {},
      piiFlags: rawInput.piiFlags ?? {}
    };

    // Pre-validate artifacts checksums synchronously to avoid failing inside DB transaction
    if (input.artifacts?.length) {
      for (const artifact of input.artifacts) {
        ensureArtifactValidity(artifact);
        try {
          // validateArtifactChecksum handles s3:// and http(s) urls
          const ok = await s3Client.validateArtifactChecksum(artifact.artifactUrl, artifact.sha256);
          if (!ok) throw new Error(`checksum mismatch for ${artifact.artifactUrl}`);
        } catch (err) {
          throw new Error(`artifact validation failed for ${artifact.artifactUrl}: ${(err as Error).message || err}`);
        }
      }
    }

    // Prepare audit payload
    const auditPayload = {
      owner: input.owner,
      metadata: input.metadata ?? {},
      caller: ctx.caller ?? 'unknown'
    };

    // Insert node + artifacts + audit atomically
    const { node, audit } = await insertMemoryNodeWithAudit(
      input,
      'memory.node.created',
      auditPayload,
      ctx.manifestSignatureId ?? null
    );

    // Async: attempt vector upsert; do not block API response
    let vectorRef: string | null = null;
    if (input.embedding) {
      (async () => {
        try {
          const writeRes = await deps.vectorAdapter.upsertEmbedding({
            memoryNodeId: node.id,
            embeddingId: input.embeddingId ?? node.embedding_id ?? undefined,
            embedding: input.embedding,
            metadata: {
              owner: node.owner,
              metadata: node.metadata,
              piiFlags: node.pii_flags
            }
          });
          if (writeRes.externalVectorId) {
            // persist external vector id
            try {
              await updateMemoryNodeEmbedding(node.id, writeRes.externalVectorId);
            } catch (e) {
              // non-fatal; log
              console.error('[memoryService] failed to persist external vector id:', (e as Error).message || e);
            }
            vectorRef = writeRes.externalVectorId;
          }
        } catch (err) {
          console.error('[memoryService] vector upsert failed, enqueuing for retry:', (err as Error).message || err);
          try {
            const pool = getPool();
            const provider = process.env.VECTOR_DB_PROVIDER ?? 'postgres';
            const namespace = process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory';
            const embedding = input.embedding;
            await pool.query(
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
                    error = EXCLUDED.error,
                    updated_at = now()
            `,
              [
                node.id,
                provider,
                namespace,
                embedding.model,
                embedding.dimension ?? (Array.isArray(embedding.vector) ? embedding.vector.length : null),
                input.embeddingId ?? null,
                'pending',
                (err as Error).message ?? 'adapter_error',
                JSON.stringify(embedding.vector ?? []),
                JSON.stringify({
                  owner: node.owner,
                  metadata: node.metadata,
                  piiFlags: node.pii_flags
                })
              ]
            );
          } catch (uerr) {
            console.error('[memoryService] failed to enqueue vector for retry:', (uerr as Error).message || uerr);
          }
        }
      })();
    }

    return {
      memoryNodeId: node.id,
      embeddingVectorId: vectorRef,
      auditEventId: audit.id
    };
  },

  async getMemoryNode(id: string): Promise<MemoryNodeView | null> {
    const node = await getMemoryNodeById(id);
    if (!node) return null;
    const artifacts = await getArtifactsByNodeId(id);
    const latestAudit = await getLatestAuditForMemoryNode(id);

    return toMemoryNodeView(
      node,
      artifacts.map((artifact) => ({
        artifactId: artifact.id,
        artifactUrl: artifact.artifact_url,
        sha256: artifact.sha256,
        manifestSignatureId: artifact.manifest_signature_id,
        sizeBytes: artifact.size_bytes ?? null
      })),
      latestAudit
        ? {
            auditEventId: latestAudit.id,
            hash: latestAudit.hash,
            createdAt: latestAudit.created_at
          }
        : undefined
    );
  },

  async getArtifact(id: string): Promise<ArtifactView | null> {
    const artifact = await getArtifactById(id);
    if (!artifact) return null;
    const latestAudit = await getLatestAuditForArtifact(id);
    return {
      ...artifact,
      latestAudit: latestAudit
        ? {
            auditEventId: latestAudit.id,
            hash: latestAudit.hash,
            createdAt: latestAudit.created_at
          }
        : undefined
    };
  },

  async createArtifact(nodeId: string | null, artifact: ArtifactInput, ctx: AuditContext) {
    ensureArtifactValidity(artifact);

    // Validate checksum synchronously before persisting metadata
    try {
      const ok = await s3Client.validateArtifactChecksum(artifact.artifactUrl, artifact.sha256);
      if (!ok) throw new Error('checksum mismatch');
    } catch (err) {
      throw new Error(`artifact checksum validation failed: ${(err as Error).message || err}`);
    }

    const artifactId = await insertArtifact(nodeId, artifact);
    if (!artifactId) throw new Error('failed to persist artifact metadata');

    const auditEvent = await insertAuditEvent({
      eventType: 'memory.artifact.created',
      memoryNodeId: nodeId,
      artifactId,
      payload: {
        artifactUrl: artifact.artifactUrl,
        sha256: artifact.sha256,
        caller: ctx.caller ?? 'unknown'
      },
      manifestSignatureId: artifact.manifestSignatureId ?? ctx.manifestSignatureId,
      callerPrevHash: ctx.prevAuditHash
    });

    return { artifactId, auditEventId: auditEvent.id };
  },

  async searchMemoryNodes(request: SearchRequest): Promise<SearchResult[]> {
    const vectorResults = await deps.vectorAdapter.search(request);
    if (!vectorResults.length) return [];

    const ids = vectorResults.map((r) => r.memoryNodeId);
    const nodes = await findMemoryNodesByIds(ids);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const filtered = vectorResults.filter((r) => {
      const node = nodeMap.get(r.memoryNodeId);
      return node ? true : false; // additional filtering by metadata could be applied
    });

    const artifactsMap = await getArtifactsForNodes(filtered.map((r) => r.memoryNodeId));

    return filtered.map((r) => {
      const node = nodeMap.get(r.memoryNodeId);
      const artifactIds = (artifactsMap.get(r.memoryNodeId) ?? []).map((a) => a.id);
      return {
        memoryNodeId: r.memoryNodeId,
        score: r.score,
        metadata: node?.metadata ?? r.metadata ?? {},
        artifactIds,
        vectorRef: r.vectorRef ?? null
      };
    });
  },

  async setLegalHold(id: string, legalHold: boolean, reason: string | undefined, ctx: AuditContext) {
    const node = await getMemoryNodeById(id);
    if (!node) throw new Error('memory node not found');
    await setLegalHoldDb(id, legalHold, reason);
    await insertAuditEvent({
      eventType: 'memory.node.legal_hold.updated',
      memoryNodeId: id,
      payload: {
        legalHold,
        reason,
        caller: ctx.caller ?? 'unknown'
      },
      callerPrevHash: ctx.prevAuditHash,
      manifestSignatureId: ctx.manifestSignatureId
    });
  },

  async deleteMemoryNode(id: string, requestedBy: string | undefined, ctx: AuditContext) {
    const node = await getMemoryNodeById(id);
    if (!node) throw new Error('memory node not found');
    if (node.legal_hold) throw new Error('cannot delete node under legal hold');
    await softDeleteMemoryNode(id, requestedBy ?? 'system');
    await insertAuditEvent({
      eventType: 'memory.node.deleted',
      memoryNodeId: id,
      payload: {
        requestedBy,
        caller: ctx.caller ?? 'unknown'
      },
      callerPrevHash: ctx.prevAuditHash,
      manifestSignatureId: ctx.manifestSignatureId
    });
  }
});

export type { MemoryNodeRecord };

