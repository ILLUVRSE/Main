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
  insertMemoryNode,
  setLegalHold as setLegalHoldDb,
  softDeleteMemoryNode,
  updateMemoryNodeEmbedding
} from '../db';
import { VectorDbAdapter } from '../vector/vectorDbAdapter';
import type {
  ArtifactInput,
  ArtifactView,
  AuditContext,
  MemoryNodeInput,
  MemoryNodeRecord,
  MemoryNodeView,
  MemoryService,
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

export const createMemoryService = (deps: MemoryServiceDeps): MemoryService => ({
  async createMemoryNode(rawInput: MemoryNodeInput, ctx: AuditContext) {
    ensureOwner(rawInput);
    ensureTtl(rawInput);
    const input = ensureMetadataDefaults(rawInput);

    const node = await insertMemoryNode(input);

    let vectorRef: string | null = null;
    if (input.embedding) {
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
        await updateMemoryNodeEmbedding(node.id, vectorResponse.externalVectorId);
        vectorRef = vectorResponse.externalVectorId ?? null;
      }
    }

    if (input.artifacts?.length) {
      for (const artifact of input.artifacts) {
        ensureArtifactValidity(artifact);
        await insertArtifact(node.id, artifact);
      }
    }

    const auditEvent = await insertAuditEvent({
      eventType: 'memory.node.created',
      memoryNodeId: node.id,
      payload: {
        owner: node.owner,
        metadata: node.metadata,
        caller: ctx.caller ?? 'unknown'
      },
      manifestSignatureId: ctx.manifestSignatureId,
      callerPrevHash: ctx.prevAuditHash
    });

    return {
      memoryNodeId: node.id,
      embeddingVectorId: vectorRef,
      auditEventId: auditEvent.id
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
