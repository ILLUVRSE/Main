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

export interface ArtifactRecord {
  id: string;
  memory_node_id: string | null;
  artifact_url: string;
  sha256: string;
  manifest_signature_id: string | null;
  size_bytes: number | null;
  created_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ArtifactView extends ArtifactRecord {
  latestAudit?: {
    auditEventId: string;
    hash: string;
    createdAt: string;
  };
}

export interface AuditEventRecord {
  id: string;
  hash: string;
  prev_hash: string | null;
  signature: string | null;
  manifest_signature_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
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

export interface MemoryNodeView {
  memoryNodeId: string;
  owner: string;
  embeddingId: string | null;
  metadata: Record<string, unknown>;
  piiFlags: Record<string, unknown>;
  legalHold: boolean;
  ttlSeconds: number | null;
  expiresAt: string | null;
  artifacts: Array<{
    artifactId: string;
    artifactUrl: string;
    sha256: string;
    manifestSignatureId: string | null;
    sizeBytes: number | null;
  }>;
  latestAudit?: {
    auditEventId: string;
    hash: string;
    createdAt: string;
  };
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
  metadata: Record<string, unknown>;
  artifactIds: string[];
  vectorRef?: string | null;
}

export interface AuditContext {
  manifestSignatureId?: string;
  prevAuditHash?: string;
  caller?: string;
}

export interface MemoryService {
  createMemoryNode(input: MemoryNodeInput, ctx: AuditContext): Promise<{
    memoryNodeId: string;
    embeddingVectorId?: string | null;
    auditEventId: string;
  }>;
  getMemoryNode(id: string): Promise<MemoryNodeView | null>;
  getArtifact(id: string): Promise<ArtifactView | null>;
  createArtifact(nodeId: string | null, artifact: ArtifactInput, ctx: AuditContext): Promise<{ artifactId: string; auditEventId: string }>;
  searchMemoryNodes(request: SearchRequest): Promise<SearchResult[]>;
  setLegalHold(id: string, legalHold: boolean, reason: string | undefined, ctx: AuditContext): Promise<void>;
  deleteMemoryNode(id: string, requestedBy: string | undefined, ctx: AuditContext): Promise<void>;
}
