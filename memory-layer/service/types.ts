export interface EmbeddingPayload {
  model: string;
  dimension: number;
  vector: number[];
  namespace?: string;
}

export interface ArtifactInput {
  artifactUrl: string;
  sha256: string;
  sizeBytes?: number;
  manifestSignatureId?: string;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryNodeInput {
  owner: string;
  embeddingId?: string | null;
  metadata?: Record<string, unknown>;
  piiFlags?: Record<string, unknown>;
  legalHold?: boolean;
  ttlSeconds?: number | null;
  embedding?: EmbeddingPayload;
  artifacts?: ArtifactInput[];
}

export interface MemoryNodeRecord {
  id: string;
  owner: string;
  embedding_id: string | null;
  metadata: Record<string, unknown>;
  pii_flags: Record<string, unknown>;
  legal_hold: boolean;
  ttl_seconds: number | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SearchRequest {
  queryEmbedding: number[];
  topK?: number;
  filter?: Record<string, unknown>;
  namespace?: string;
  scoreThreshold?: number;
}

export interface SearchResult {
  memoryNodeId: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface AuditContext {
  manifestSignatureId?: string;
  prevAuditHash?: string;
  caller?: string;
}

export interface MemoryService {
  createMemoryNode(input: MemoryNodeInput, ctx: AuditContext): Promise<{
    memoryNodeId: string;
    embeddingJobId?: string | null;
    auditEventId: string;
  }>;
  getMemoryNode(id: string): Promise<MemoryNodeRecord | null>;
  createArtifact(nodeId: string | null, artifact: ArtifactInput, ctx: AuditContext): Promise<{ artifactId: string; auditEventId: string }>;
  searchMemoryNodes(request: SearchRequest): Promise<SearchResult[]>;
  setLegalHold(id: string, legalHold: boolean, reason?: string): Promise<void>;
  deleteMemoryNode(id: string, requestedBy?: string): Promise<void>;
}
