/**
 * memory-layer/service/services/memoryService.ts
 *
 * MemoryService implementation (updated):
 *  - Uses insertMemoryNodeWithAudit(...) to atomically persist node+artifacts+audit.
 *  - Validates artifact checksums via s3Client before DB insert.
 *  - Performs vector upserts after DB commit; if upsert fails, writes a pending memory_vectors row for worker replay.
 *  - Uses insertAuditEvent for artifact/legal-hold/audit flows.
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

const MIN_TTL_SECONDS = 3600;
const SHA256_REGEX = /^[a-f0-9]{64}$/i;

const ensureOwner = (input: MemoryNodeInput) => {
  if (!input.owner) {
    throw new Error('owner is required.');
  }
};

const ensureTtl = (input: MemoryNodeInput) => {
  if (input.ttlSeconds != null && input.ttlSeconds < MIN_TTL_SECONDS) {
    throw new Error(`ttlSeconds must be >= ${MIN_TTL_SECONDS}`);
  }
};

const ensureMetadataDefaults = (input: MemoryNodeInput) => ({
  ...input,
  metadata: input.metadata ?? {},
  piiFlags: input.piiFlags ?? {}
});

const ensureArtifactValidity = (artifact: ArtifactInput) => {
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

const extractValue = (node: MemoryNodeRecord, path: string): unknown => {
  const [root, ...rest] = path.split('.');
  const source: Record<string, unknown> = {
    owner: node.owner,
    metadata: node.metadata ?? {},
    piiFlags: node.pii_flags ?? {},
    legalHold: node.legal_hold,
    ttlSeconds: node.ttl_seconds
  };
  let current: unknown = root ? (source as Record<string, unknown>)[root] : undefined;
  for (const key of rest) {
    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[key];
    } else {
      current = undefined;
      break;
    }
  }
  return current;
};

const matchesFilter = (node: MemoryNodeRecord, filter?: Record<string, unknown>): boolean => {
  if (!filter) return true;
  return Object.entries(filter).every(([path, expected]) => {
    const actual = extractValue(node, path);
    if (Array.isArray(expected)) {
      return expected.some((value) => value === actual);
    }
    return expected === actual;
  });
};

export const createMemoryService = (deps: MemoryServiceDeps) => ({
  /**
   * Create a MemoryNode:
   *  - validate artifacts (checksum) before DB insert
   *  - call insertMemoryNodeWithAudit to persist node + artifacts + audit atomically
   *  - asynchronously attempt vector upsert; on failure insert memory_vectors row for worker replay
   */
  async createMemoryNode(rawInput: MemoryNodeInput, ctx: AuditContext) {
    ensureOwner(rawInput);
    ensureTtl(rawInput);
    const input = ensureMetadataDefaults(rawInput);

    // Validate artifacts' checksum before DB transaction
    if (input.artifacts?.length) {
      for (const artifact of input.artifacts) {
        ensureArtifactValidity(artifact);
        // Validate checksum by streaming S3/HTTP
        try {
          const ok = await s3Client.validateArtifactChecksum(artifact.artifactUrl, artifact.sha256);
          if (!ok) {
            throw new Error(`checksum mismatch for ${artifact.artifactUrl}`);
          }
        } catch (err) {
          throw new Error(`artifact validation failed for ${artifact.artifactUrl}: ${(err as Error).message || err}`);
        }
      }
    }

    // Build audit payload
    const auditPayload = {
      owner: input.owner,
      metadata: input.metadata ?? {},
      caller: ctx.caller ?? 'unknown'
    };

    // Insert node + artifacts + audit atomically
    const { node, audit } = await insertMemoryNodeWithAudit(input, 'memory.node.created', auditPayload, ctx.manifestSignatureId ?? null);

    // After commit: attempt vector upsert (async). We do not block the API response on vector DB.
    let vectorRef: string | null = null;
    if (input.embedding) {
      try {
        const vectorResponse = await deps.vectorAdapter.upsertEmbedding({
          memoryNodeId: node.id,
          embeddingId: input.embeddingId ?? node.embedding_id,
          embedding: input.embedding,
          metadata: {
            owner: node.owner,
            metadata: node.metadata,
            piiFlags: node.pii_flags
          }
        });
        if (vectorResponse.externalVectorId) {
          // persist external vector id on memory_nodes
          await updateMemoryNodeEmbedding(node.id, vectorResponse.externalVectorId);
          vectorRef = vectorResponse.externalVectorId ?? null;
        }
      } catch (err) {
        // Adapter failed — insert a pending memory_vectors row so worker can retry.
        console.error(`[memoryService] vector upsert failed for node ${node.id}:`, (err as Error).message || err);
        try {
          const pool = getPool();
          const provider = process.env.VECTOR_DB_PROVIDER ?? 'postgres';
          const namespace = process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory';
          const embedding = input.embedding;
          // write vector_data as JSONB, status 'pending' so worker will pick it up
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

    // Validate checksum before persisting artifact metadata
    try {
      const ok = await s3Client.validateArtifactChecksum(artifact.artifactUrl, artifact.sha256);
      if (!ok) {
        throw new Error('checksum mismatch');
      }
    } catch (err) {
      throw new Error(`artifact checksum validation failed: ${(err as Error).message || err}`);
    }

    const artifactId = await insertArtifact(nodeId, artifact);
    if (!artifactId) {
      throw new Error('failed to persist artifact metadata');
    }

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
    if (!vectorResults.length) {
      return [];
    }

    const ids = vectorResults.map((result) => result.memoryNodeId);
    const nodes = await findMemoryNodesByIds(ids);
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const filteredResults = vectorResults.filter((result) => {
      const node = nodeMap.get(result.memoryNodeId);
      return node ? matchesFilter(node, request.filter) : false;
    });
    if (!filteredResults.length) return [];

    const artifactsMap = await getArtifactsForNodes(filteredResults.map((result) => result.memoryNodeId));

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

  async setLegalHold(id: string, legalHold: boolean, reason: string | undefined, ctx: AuditContext) {
    const node = await getMemoryNodeById(id);
    if (!node) {
      throw new Error('memory node not found.');
    }
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
    if (!node) {
      throw new Error('memory node not found.');
    }
    if (node.legal_hold) {
      throw new Error('cannot delete node under legal hold.');
    }
    await softDeleteMemoryNode(id, requestedBy);
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

