/**
 * kernel/src/types.ts
 *
 * Canonical TypeScript types for Kernel API & DB models.
 * These mirror the canonical definitions in kernel/data-models.md.
 *
 * API uses camelCase. DB uses snake_case. Keep a single mapping layer
 * in application code where needed.
 *
 * Do NOT put secrets here.
 */

/** DivisionManifest — authoritative description of a Division */
export interface DivisionManifest {
  id: string; // uuid
  name?: string;
  goals?: string[]; // top-level goals
  budget?: number;
  currency?: string; // ISO currency code, e.g., "USD"
  kpis?: string[];
  policies?: string[];
  metadata?: Record<string, any>;
  status?: 'active' | 'paused' | 'retired';
  version?: string;
  createdAt?: string; // ISO timestamp
  updatedAt?: string; // ISO timestamp
  manifestSignatureId?: string; // FK to ManifestSignature (id)
}

/** AgentProfile — runtime record for an agent instance */
export interface AgentProfile {
  id: string; // uuid
  templateId?: string;
  role?: string;
  skills?: string[];
  codeRef?: string; // git URL + ref or image URI
  divisionId?: string; // FK to DivisionManifest.id
  state?: 'stopped' | 'running' | 'paused' | 'failed';
  score?: number;
  resourceAllocation?: ResourceAllocation | Record<string, any>;
  lastHeartbeat?: string; // ISO timestamp
  owner?: string; // team or user
  createdAt?: string;
  updatedAt?: string;
}

/** EvalReport — a single evaluation submission for an agent */
export interface EvalReport {
  id?: string; // uuid
  agentId: string; // uuid
  metricSet: Record<string, any>; // arbitrary metric key -> value
  timestamp?: string; // ISO timestamp
  source?: string; // which system produced it
  computedScore?: number; // optional cached score
  window?: string; // optional window/period
}

/** MemoryNode — persistent memory item (metadata stored in Postgres) */
export interface MemoryNode {
  id?: string; // uuid
  text?: string | null;
  embeddingId?: string | null; // id in the vector DB
  metadata?: Record<string, any>;
  createdAt?: string;
  ttl?: string | null; // ISO timestamp or null
}

/** ManifestSignature — record that a manifest was signed */
export interface ManifestSignature {
  id?: string; // uuid
  manifestId?: string;
  signerId: string;
  signature: string; // base64
  version?: string;
  ts?: string; // ISO timestamp
  prevHash?: string | null;
}

/** AuditEvent — immutable event on the append-only audit bus */
export interface AuditEvent {
  id?: string; // uuid
  eventType: string;
  payload: Record<string, any>;
  prevHash?: string | null;
  hash?: string; // sha256 hex
  signature?: string; // base64
  signerId?: string;
  ts?: string; // ISO timestamp
}

/** ResourceAllocation — record of compute/capital assignment */
export interface ResourceAllocation {
  id?: string; // uuid
  entityId: string; // agentId or divisionId
  pool?: string;
  delta?: number;
  reason?: string;
  requestedBy?: string;
  status?: 'pending' | 'applied' | 'rejected';
  ts?: string; // ISO timestamp
}

/**
 * Acceptance criteria (short, testable)
 *
 * - All exported types align to the canonical fields in kernel/data-models.md.
 *   Test: `tsc` and run a quick compile; use these types in server handlers and ensure no missing/renamed fields.
 *
 * - Type coverage: DivisionManifest, AgentProfile, EvalReport, ManifestSignature, AuditEvent, MemoryNode, ResourceAllocation exist and are exported.
 *   Test: Import types into server code and compile with `tsc --noEmit`.
 *
 * - Optional: Add mapping helpers to convert from DB snake_case rows to camelCase API types and vice-versa.
 *   Test: Create a small unit test that maps a simulated DB row to the TS interface and run `ts-node`/`jest` to confirm shapes.
 */

