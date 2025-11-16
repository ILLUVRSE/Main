/**
 * memory-layer/service/types.ts
 *
 * Shared TypeScript types used across the Memory Layer service.
 *
 * Keep these types conservative and compatible with DB rows returned as `any`.
 */

export type UUID = string;

/* ---------------------------
   DB row / record types
   --------------------------- */

export type MemoryNodeRecord = {
  id: UUID;
  owner: string;
  embedding_id: string | null;
  metadata: any; // JSONB
  pii_flags: any; // JSONB
  legal_hold: boolean;
  legal_hold_reason?: string | null;
  ttl_seconds?: number | null;
  expires_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type ArtifactRecord = {
  id: UUID;
  memory_node_id?: string | null;
  artifact_url: string;
  sha256: string;
  manifest_signature_id?: string | null;
  size_bytes?: number | null;
  created_by?: string | null;
  metadata: any;
  created_at: string;
  updated_at: string;
};

export type AuditEventRecord = {
  id: UUID;
  event_type: string;
  memory_node_id?: string | null;
  artifact_id?: string | null;
  payload: any;
  hash: string;
  prev_hash?: string | null;
  signature?: string | null;
  manifest_signature_id?: string | null;
  created_at: string;
};

/* ---------------------------
   API / service input types
   --------------------------- */

export type ArtifactInput = {
  artifactUrl: string;
  sha256: string;
  manifestSignatureId?: string | null;
  sizeBytes?: number | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
};

export type MemoryEmbedding = {
  model: string;
  dimension?: number | null;
  vector: number[];
  namespace?: string;
};

export type MemoryNodeInput = {
  owner: string;
  embedding?: MemoryEmbedding | null;
  embeddingId?: string | null;
  artifacts?: ArtifactInput[] | null;
  metadata?: Record<string, unknown> | null;
  piiFlags?: Record<string, unknown> | null;
  legalHold?: boolean | null;
  ttlSeconds?: number | null;
};

export type AuditContext = {
  manifestSignatureId?: string | null;
  prevAuditHash?: string | null;
  caller?: string | null;
};

/* ---------------------------
   API / service view types
   --------------------------- */

export type ArtifactView = {
  artifactId: string;
  artifactUrl: string;
  sha256: string;
  manifestSignatureId?: string | null;
  sizeBytes?: number | null;
  metadata?: any;
  latestAudit?: { auditEventId: string; hash: string; createdAt: string } | undefined;
};

export type MemoryNodeView = {
  memoryNodeId: string;
  owner: string;
  embeddingId?: string | null;
  metadata: Record<string, unknown>;
  piiFlags: Record<string, unknown>;
  legalHold: boolean;
  ttlSeconds?: number | null;
  expiresAt?: string | null;
  artifacts: ArtifactView[];
  latestAudit?: { auditEventId: string; hash: string; createdAt: string } | undefined;
};

/* ---------------------------
   Search / Vector types
   --------------------------- */

export type SearchRequest = {
  queryEmbedding?: number[];
  topK?: number;
  namespace?: string;
  filter?: Record<string, unknown> | null;
  scoreThreshold?: number | null;
};

export type SearchResult = {
  memoryNodeId: string;
  score: number;
  metadata?: Record<string, unknown>;
  artifactIds: string[];
  vectorRef?: string | null;
};

export type VectorWriteResult = {
  status: 'queued' | 'completed';
  externalVectorId?: string | null;
};

export type VectorSearchResult = {
  memoryNodeId: string;
  score: number;
  metadata?: Record<string, unknown>;
  vectorRef?: string | null;
};

export type MemoryServiceDeps = {
  vectorAdapter: {
    upsertEmbedding(args: {
      memoryNodeId: string;
      embeddingId?: string | null;
      embedding: MemoryEmbedding;
      metadata?: Record<string, unknown>;
    }): Promise<VectorWriteResult>;
    search(request: { queryEmbedding?: number[]; topK?: number; namespace?: string; scoreThreshold?: number }): Promise<VectorSearchResult[]>;
    healthCheck(): Promise<{ healthy: boolean; details?: Record<string, unknown> }>;
  };
};

export default {};

