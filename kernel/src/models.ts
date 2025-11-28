/**
 * kernel/src/models.ts
 *
 * DB ↔ API mapping helpers for Kernel models.
 * - Convert Postgres rows (snake_case) into camelCase API types.
 * - Provide lightweight helpers to prepare values for DB INSERT/UPDATE.
 *
 * Keep these mapping functions small and deterministic so tests can validate transformations.
 */

import {
  DivisionManifest,
  AgentProfile,
  EvalReport,
  MemoryNode,
  ManifestSignature,
  AuditEvent,
  ResourceAllocation,
} from './types';

/** Utility: convert Postgres timestamp (Date|string) to ISO string or undefined */
function toIso(ts: any): string | undefined {
  if (!ts) return undefined;
  const d = ts instanceof Date ? ts : new Date(ts);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Division: DB row -> DivisionManifest (camelCase) */
export function dbRowToDivisionManifest(row: any): DivisionManifest {
  if (!row) return row;
  return {
    id: String(row.id),
    name: row.name ?? undefined,
    goals: row.goals ?? undefined,
    budget: row.budget != null ? Number(row.budget) : undefined,
    currency: row.currency ?? undefined,
    kpis: row.kpis ?? undefined,
    policies: row.policies ?? undefined,
    metadata: row.metadata ?? undefined,
    status: (row.status as DivisionManifest['status']) ?? undefined,
    version: row.version ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    manifestSignatureId: row.manifest_signature_id ?? undefined,
  };
}

/** Agent: DB row -> AgentProfile */
export function dbRowToAgentProfile(row: any): AgentProfile {
  if (!row) return row;
  return {
    id: String(row.id),
    templateId: row.template_id ?? undefined,
    role: row.role ?? undefined,
    skills: row.skills ?? undefined,
    codeRef: row.code_ref ?? undefined,
    divisionId: row.division_id ?? undefined,
    state: row.state as AgentProfile['state'] ?? undefined,
    score: row.score != null ? Number(row.score) : undefined,
    resourceAllocation: row.resource_allocation ?? undefined,
    lastHeartbeat: toIso(row.last_heartbeat),
    owner: row.owner ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/** Eval report: DB row -> EvalReport */
export function dbRowToEvalReport(row: any): EvalReport {
  if (!row) return row;
  return {
    id: String(row.id),
    agentId: row.agent_id,
    metricSet: row.metric_set ?? {},
    timestamp: toIso(row.timestamp),
    source: row.source ?? undefined,
    computedScore: row.computed_score != null ? Number(row.computed_score) : undefined,
    window: row.window ?? undefined,
  };
}

/** Memory node: DB row -> MemoryNode */
export function dbRowToMemoryNode(row: any): MemoryNode {
  if (!row) return row;
  return {
    id: String(row.id),
    text: row.text ?? undefined,
    embeddingId: row.embedding_id ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: toIso(row.created_at),
    ttl: toIso(row.ttl),
  };
}

/** Memory node: MemoryNode -> DB values */
export function memoryNodeToDbRow(node: MemoryNode): any[] {
  return [
    node.id ?? null,
    node.text ?? null,
    node.embeddingId ?? null,
    node.metadata ?? {},
    node.ttl ?? null,
  ];
}

/** ManifestSignature: DB row -> ManifestSignature */
export function dbRowToManifestSignature(row: any): ManifestSignature {
  if (!row) return row;
  return {
    id: String(row.id),
    manifestId: row.manifest_id ?? undefined,
    signerId: row.signer_id ?? undefined,
    signature: row.signature ?? undefined,
    algorithm: row.algorithm ?? undefined,
    keyVersion: row.key_version ?? undefined,
    version: row.version ?? undefined,
    ts: toIso(row.ts),
    prevHash: row.prev_hash ?? undefined,
  };
}

/** AuditEvent: DB row -> AuditEvent */
export function dbRowToAuditEvent(row: any): AuditEvent {
  if (!row) return row;
  return {
    id: String(row.id),
    eventType: row.event_type,
    payload: row.payload ?? {},
    prevHash: row.prev_hash ?? undefined,
    hash: row.hash ?? undefined,
    signature: row.signature ?? undefined,
    signerId: row.signer_id ?? undefined,
    ts: toIso(row.ts),
  };
}

/** ResourceAllocation: DB row -> ResourceAllocation */
export function dbRowToResourceAllocation(row: any): ResourceAllocation {
  if (!row) return row;
  return {
    id: String(row.id),
    entityId: row.entity_id,
    pool: row.pool ?? undefined,
    delta: row.delta != null ? Number(row.delta) : undefined,
    reason: row.reason ?? undefined,
    requestedBy: row.requested_by ?? undefined,
    status: row.status as ResourceAllocation['status'] ?? undefined,
    ts: toIso(row.ts),
  };
}

/**
 * Prepare a DivisionManifest for DB upsert: returns tuple of values in appropriate order.
 * Used by server handlers to avoid repeating mapping logic.
 *
 * Order: id, name, goals, budget, currency, kpis, policies, metadata, status, version, manifest_signature_id
 */
export function divisionManifestToDbRow(m: DivisionManifest): any[] {
  return [
    m.id,
    m.name ?? null,
    m.goals ?? [],
    m.budget ?? 0,
    m.currency ?? 'USD',
    m.kpis ?? [],
    m.policies ?? [],
    m.metadata ?? {},
    m.status ?? 'active',
    m.version ?? '1.0.0',
    m.manifestSignatureId ?? null,
  ];
}

/**
 * Acceptance criteria (short, testable):
 *
 * - Each dbRowTo* function maps snake_case DB rows to camelCase API types consistently.
 *   Test: Create a mock DB row for each table and assert mapping output matches expected API shape.
 *
 * - divisionManifestToDbRow produces values in exact order expected by server upsert SQL.
 *   Test: Call divisionManifestToDbRow(manifest) and use returned array as parameters for the divisions upsert; SQL should succeed.
 *
 * - toIso returns undefined for null/invalid values and ISO string for valid timestamps.
 *   Test: pass Date, ISO string, and null and assert outputs.
 */
