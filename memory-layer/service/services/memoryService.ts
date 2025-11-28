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

// Observability
import metricsModule from '../observability/metrics';
import tracing from '../observability/tracing';

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

    // Metrics: ingestion attempt
    try {
      metricsModule.metrics.ingestion.inc({ owner: input.owner, result: 'started' });
    } catch {
      // ignore metrics failures
    }

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
          // Record metric for failure
          try {
            metricsModule.metrics.ingestion.inc({ owner: input.owner, result: 'artifact_validation_failed' });
          } catch {}
          throw new Error(`artifact validation failed for ${artifact.artifactUrl}: ${(err as Error).message || err}`);
        }
      }
    }

    // Build audit payload and inject tracing info
    let auditPayload: Record<string, unknown> = {
      owner: input.owner,
      metadata: input.metadata ?? {},
      caller: ctx.caller ?? 'unknown'
    };

    try {
      auditPayload = tracing.injectTraceIntoAuditPayload(auditPayload);
    } catch {
      // ignore tracing issues
    }

    // Insert node + artifacts + audit atomically
    let node: MemoryNodeRecord;
    let audit: { id: string };
    try {
      const res = await insertMemoryNodeWithAudit(input, 'memory.node.created', auditPayload, ctx.manifestSignatureId ?? null);
      node = res.node;
      audit = res.audit as any;
    } catch (err) {
      // Record audit sign failure metric if signing failed
      const msg = (err as Error).message || String(err);
      try {
        if (msg.toLowerCase().includes('audit signing failed') || msg.toLowerCase().includes('audit signing required')) {
          metricsModule.metrics.audit.failure({ reason: 'signing_failed' });
        } else {
          metricsModule.metrics.audit.failure({ reason: 'insert_failed' });
        }
      } catch {
        // ignore
      }
      // propagate error
      throw err;
    }

    // Record memory node created metric
    try {
      metricsModule.metrics.memoryNode.created({ owner: node.owner });
      metricsModule.metrics.ingestion.inc({ owner: node.owner, result: 'succeeded' });
    } catch {
      // ignore metrics failures
    }

    // After commit: The vectors and reasoning graph updates are already queued in the DB transaction.
    // The workers will pick them up.
    // We can optionally trigger workers or return immediate status 'queued'.

    // Optimization: Trigger workers (or if we want to wait for completion, we could, but better to be async).
    // For now we return immediately.

    return {
      memoryNodeId: node.id,
      embeddingVectorId: null, // Asynchronous now
      auditEventId: (audit as any).id
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
  artifactId: artifact.id,
  artifactUrl: artifact.artifact_url,
  sha256: artifact.sha256,
  manifestSignatureId: artifact.manifest_signature_id ?? null,
  sizeBytes: artifact.size_bytes ?? null,
  createdAt: artifact.created_at,
  metadata: artifact.metadata,
  latestAudit: latestAudit ? { auditEventId: latestAudit.id, hash: latestAudit.hash, createdAt: latestAudit.created_at } : undefined
} as ArtifactView;
  },

  async createArtifact(nodeId: string | null, artifact: ArtifactInput, ctx: AuditContext) {
    ensureArtifactValidity(artifact);

    // Validate checksum before persisting artifact metadata
    try {
      const ok = await s3Client.validateArtifactChecksum(artifact.artifactUrl, artifact.sha256);
      if (!ok) {
        try {
          metricsModule.metrics.ingestion.inc({ owner: artifact.createdBy ?? 'unknown', result: 'artifact_validation_failed' });
        } catch {}
        throw new Error('checksum mismatch');
      }
    } catch (err) {
      throw new Error(`artifact checksum validation failed: ${(err as Error).message || err}`);
    }

    const artifactId = await insertArtifact(nodeId, artifact);
    if (!artifactId) {
      try {
        metricsModule.metrics.ingestion.inc({ owner: artifact.createdBy ?? 'unknown', result: 'artifact_persist_failed' });
      } catch {}
      throw new Error('failed to persist artifact metadata');
    }

    // Attach trace info to audit payload
    let auditPayload: Record<string, unknown> = {
      artifactUrl: artifact.artifactUrl,
      sha256: artifact.sha256,
      caller: ctx.caller ?? 'unknown'
    };
    try {
      auditPayload = tracing.injectTraceIntoAuditPayload(auditPayload);
    } catch {
      // ignore
    }

    const auditEvent = await insertAuditEvent({
      eventType: 'memory.artifact.created',
      memoryNodeId: nodeId,
      artifactId,
      payload: auditPayload,
      manifestSignatureId: artifact.manifestSignatureId ?? ctx.manifestSignatureId,
      callerPrevHash: ctx.prevAuditHash
    }).catch((err) => {
      try {
        metricsModule.metrics.audit.failure({ reason: 'artifact_audit_failed' });
      } catch {}
      throw err;
    });

    return { artifactId, auditEventId: auditEvent.id };
  },

  async searchMemoryNodes(request: SearchRequest): Promise<SearchResult[]> {
    const start = Date.now();
    const vectorResults = await deps.vectorAdapter.search({ queryEmbedding: request.queryEmbedding, topK: request.topK, namespace: request.namespace, scoreThreshold: request.scoreThreshold ?? undefined });
    const elapsed = (Date.now() - start) / 1000.0;
    try {
      metricsModule.metrics.search.observe({ namespace: request.namespace ?? process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory' }, elapsed);
    } catch {}

    if (!vectorResults.length) {
      return [];
    }

    const ids = vectorResults.map((result) => result.memoryNodeId);
    const nodes = await findMemoryNodesByIds(ids);
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const filteredResults = vectorResults.filter((result) => {
      const node = nodeMap.get(result.memoryNodeId);
      return node ? matchesFilter(node, request.filter ?? undefined) : false;
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
    // Attach trace to payload
    let payload: Record<string, unknown> = {
      legalHold,
      reason,
      caller: ctx.caller ?? 'unknown'
    };
    try {
      payload = tracing.injectTraceIntoAuditPayload(payload);
    } catch {}

    await insertAuditEvent({
      eventType: 'memory.node.legal_hold.updated',
      memoryNodeId: id,
      payload,
      callerPrevHash: ctx.prevAuditHash,
      manifestSignatureId: ctx.manifestSignatureId
    }).catch((err) => {
      try {
        metricsModule.metrics.audit.failure({ reason: 'legal_hold_audit_failed' });
      } catch {}
      throw err;
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
    // Build audit payload and attach trace
    let auditPayload: Record<string, unknown> = {
      requestedBy,
      caller: ctx.caller ?? 'unknown'
    };
    try {
      auditPayload = tracing.injectTraceIntoAuditPayload(auditPayload);
    } catch {}

    await insertAuditEvent({
      eventType: 'memory.node.deleted',
      memoryNodeId: id,
      payload: auditPayload,
      callerPrevHash: ctx.prevAuditHash,
      manifestSignatureId: ctx.manifestSignatureId
    }).catch((err) => {
      try {
        metricsModule.metrics.memoryNode.deleted({ owner: node.owner, reason: 'delete_failed' });
      } catch {}
      throw err;
    });

    // Record metric for deletion
    try {
      metricsModule.metrics.memoryNode.deleted({ owner: node.owner, reason: 'manual' });
    } catch {}
  }
});

export type { MemoryNodeRecord };
export default createMemoryService;

