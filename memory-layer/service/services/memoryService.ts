import {
  findMemoryNodesByIds,
  getMemoryNodeById,
  insertArtifact,
  insertAuditEvent,
  insertMemoryNode,
  setLegalHold as setLegalHoldDb,
  softDeleteMemoryNode
} from '../db';
import { VectorDbAdapter } from '../vector/vectorDbAdapter';
import type { ArtifactInput, AuditContext, MemoryNodeInput, MemoryNodeRecord, MemoryService, SearchRequest } from '../types';

export interface MemoryServiceDeps {
  vectorAdapter: VectorDbAdapter;
}

const ensureOwner = (input: MemoryNodeInput) => {
  if (!input.owner) {
    throw new Error('owner is required.');
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
};

export const createMemoryService = (deps: MemoryServiceDeps): MemoryService => ({
  async createMemoryNode(rawInput: MemoryNodeInput, ctx: AuditContext) {
    ensureOwner(rawInput);
    const input = ensureMetadataDefaults(rawInput);

    const node = await insertMemoryNode(input);

    let vectorResponse: { externalVectorId?: string | null } | undefined;
    if (input.embedding) {
      vectorResponse = await deps.vectorAdapter.upsertEmbedding({
        memoryNodeId: node.id,
        embeddingId: input.embeddingId ?? node.embedding_id,
        embedding: input.embedding,
        metadata: input.metadata
      });
    }

    if (input.artifacts?.length) {
      for (const artifact of input.artifacts) {
        ensureArtifactValidity(artifact);
        await insertArtifact(node.id, artifact);
      }
    }

    const auditEventId = await insertAuditEvent({
      eventType: 'memory.node.created',
      memoryNodeId: node.id,
      payload: {
        owner: node.owner,
        metadata: node.metadata,
        caller: ctx.caller
      },
      manifestSignatureId: ctx.manifestSignatureId,
      prevHash: ctx.prevAuditHash
    });

    return {
      memoryNodeId: node.id,
      embeddingJobId: vectorResponse?.externalVectorId ?? null,
      auditEventId
    };
  },

  async getMemoryNode(id: string) {
    return getMemoryNodeById(id);
  },

  async createArtifact(nodeId: string | null, artifact: ArtifactInput, ctx: AuditContext) {
    ensureArtifactValidity(artifact);
    const artifactId = await insertArtifact(nodeId, artifact);
    const auditEventId = await insertAuditEvent({
      eventType: 'memory.artifact.created',
      memoryNodeId: nodeId,
      artifactId,
      payload: {
        artifactUrl: artifact.artifactUrl,
        sha256: artifact.sha256,
        caller: ctx.caller
      },
      manifestSignatureId: artifact.manifestSignatureId ?? ctx.manifestSignatureId,
      prevHash: ctx.prevAuditHash
    });

    return { artifactId, auditEventId };
  },

  async searchMemoryNodes(request: SearchRequest) {
    const vectorResults = await deps.vectorAdapter.search(request);
    if (!vectorResults.length) {
      return [];
    }

    const ids = vectorResults.map((result) => result.memoryNodeId);
    const nodes = await findMemoryNodesByIds(ids);
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));

    return vectorResults.map((result) => {
      const node = nodeMap.get(result.memoryNodeId);
      return {
        memoryNodeId: result.memoryNodeId,
        score: result.score,
        metadata: node?.metadata ?? result.metadata ?? {}
      };
    });
  },

  async setLegalHold(id: string, legalHold: boolean, reason?: string) {
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
        reason
      }
    });
  },

  async deleteMemoryNode(id: string, requestedBy?: string) {
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
        requestedBy
      }
    });
  }
});

export type { MemoryNodeRecord };
