// sentinelnet/src/services/policyStore.ts
import { query } from '../db';
import logger from '../logger';
import { Policy, NewPolicyInput, createPolicyFromInput, bumpPolicyVersion } from '../models/policy';

/**
 * Map a DB row into Policy shape expected by the application.
 */
function mapRowToPolicy(row: any): Policy {
  return {
    id: String(row.id),
    name: String(row.name),
    version: Number(row.version),
    severity: String(row.severity) as Policy['severity'],
    rule: row.rule,
    metadata: row.metadata ?? {},
    state: String(row.state) as Policy['state'],
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

/**
 * Create a new policy (initial version = 1).
 * Returns the created Policy.
 */
export async function createPolicy(input: NewPolicyInput): Promise<Policy> {
  // We let Postgres generate the UUID id and timestamps to avoid mismatch with model helper prefixes.
  const sql = `
    INSERT INTO policies (name, version, severity, rule, metadata, state, created_by)
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
    RETURNING id, name, version, severity, rule, metadata, state, created_by, created_at, updated_at
  `;

  const version = 1;
  const state = 'draft';
  const params = [
    input.name,
    version,
    input.severity,
    JSON.stringify(input.rule),
    JSON.stringify(input.metadata ?? {}),
    state,
    input.createdBy ?? null,
  ];

  try {
    const res = await query(sql, params);
    return mapRowToPolicy(res.rows[0]);
  } catch (err) {
    logger.error('createPolicy failed', err);
    throw err;
  }
}

/**
 * Get policy by id.
 */
export async function getPolicyById(id: string): Promise<Policy | null> {
  const sql = `
    SELECT id, name, version, severity, rule, metadata, state, created_by, created_at, updated_at
    FROM policies
    WHERE id = $1
    LIMIT 1
  `;
  try {
    const res = await query(sql, [id]);
    if (!res.rowCount) return null;
    return mapRowToPolicy(res.rows[0]);
  } catch (err) {
    logger.error('getPolicyById failed', err);
    throw err;
  }
}

/**
 * Find latest policy by name (highest version).
 */
export async function getLatestPolicyByName(name: string): Promise<Policy | null> {
  const sql = `
    SELECT id, name, version, severity, rule, metadata, state, created_by, created_at, updated_at
    FROM policies
    WHERE name = $1
    ORDER BY version DESC
    LIMIT 1
  `;
  try {
    const res = await query(sql, [name]);
    if (!res.rowCount) return null;
    return mapRowToPolicy(res.rows[0]);
  } catch (err) {
    logger.error('getLatestPolicyByName failed', err);
    throw err;
  }
}

/**
 * Create a new version of an existing policy (bump version).
 * `updates.rule` and `updates.metadata` may contain changes.
 * Returns the newly created version row.
 */
export async function createPolicyNewVersion(existingPolicyId: string, updates: Partial<Policy>, editedBy?: string | null): Promise<Policy> {
  // Fetch existing policy to determine name and version
  const existing = await getPolicyById(existingPolicyId);
  if (!existing) throw new Error('policy_not_found');

  const newVersion = existing.version + 1;
  const newRule = updates.rule ?? existing.rule;
  const newMetadata = updates.metadata ?? existing.metadata;
  const newSeverity = (updates.severity as Policy['severity']) ?? existing.severity;
  const newState = (updates.state as Policy['state']) ?? existing.state;

  const sql = `
    INSERT INTO policies (name, version, severity, rule, metadata, state, created_by)
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
    RETURNING id, name, version, severity, rule, metadata, state, created_by, created_at, updated_at
  `;
  const params = [
    existing.name,
    newVersion,
    newSeverity,
    JSON.stringify(newRule),
    JSON.stringify(newMetadata ?? {}),
    newState,
    editedBy ?? existing.createdBy ?? null,
  ];

  try {
    const res = await query(sql, params);
    // record history
    await recordPolicyHistory(existing.id, { version: existing.version, changes: updates, editedBy: editedBy ?? existing.createdBy ?? null });
    return mapRowToPolicy(res.rows[0]);
  } catch (err) {
    logger.error('createPolicyNewVersion failed', err);
    throw err;
  }
}

/**
 * Update metadata or state of an existing policy row (in-place).
 * Note: to create a new semantic version use createPolicyNewVersion above.
 */
export async function updatePolicyInPlace(policyId: string, updates: Partial<Policy>, editedBy?: string | null): Promise<Policy> {
  // Build dynamic set clause
  const sets: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (updates.rule !== undefined) {
    sets.push(`rule = $${i++}::jsonb`);
    params.push(JSON.stringify(updates.rule));
  }
  if (updates.metadata !== undefined) {
    sets.push(`metadata = $${i++}::jsonb`);
    params.push(JSON.stringify(updates.metadata));
  }
  if (updates.state !== undefined) {
    sets.push(`state = $${i++}`);
    params.push(updates.state);
  }
  if (updates.severity !== undefined) {
    sets.push(`severity = $${i++}`);
    params.push(updates.severity);
  }

  if (!sets.length) {
    return (await getPolicyById(policyId)) as Policy;
  }

  const sql = `
    UPDATE policies
    SET ${sets.join(', ')}
    WHERE id = $${i}
    RETURNING id, name, version, severity, rule, metadata, state, created_by, created_at, updated_at
  `;
  params.push(policyId);

  try {
    const res = await query(sql, params);
    if (!res.rowCount) throw new Error('policy_not_found');
    // record history
    await recordPolicyHistory(policyId, { version: Number(res.rows[0].version), changes: updates, editedBy: editedBy ?? null });
    return mapRowToPolicy(res.rows[0]);
  } catch (err) {
    logger.error('updatePolicyInPlace failed', err);
    throw err;
  }
}

/**
 * List policies (simple listing with optional filters).
 */
export async function listPolicies(filter?: { state?: string; severity?: string }): Promise<Policy[]> {
  const clauses: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (filter?.state) {
    clauses.push(`state = $${i++}`);
    params.push(filter.state);
  }
  if (filter?.severity) {
    clauses.push(`severity = $${i++}`);
    params.push(filter.severity);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `
    SELECT id, name, version, severity, rule, metadata, state, created_by, created_at, updated_at
    FROM policies
    ${where}
    ORDER BY name, version DESC
    LIMIT 500
  `;
  try {
    const res = await query(sql, params);
    return res.rows.map(mapRowToPolicy);
  } catch (err) {
    logger.error('listPolicies failed', err);
    throw err;
  }
}

/**
 * Set policy state (draft|simulating|canary|active|deprecated)
 */
export async function setPolicyState(policyId: string, newState: Policy['state'], editedBy?: string | null): Promise<Policy> {
  const sql = `
    UPDATE policies
    SET state = $1
    WHERE id = $2
    RETURNING id, name, version, severity, rule, metadata, state, created_by, created_at, updated_at
  `;
  try {
    const res = await query(sql, [newState, policyId]);
    if (!res.rowCount) throw new Error('policy_not_found');
    await recordPolicyHistory(policyId, { version: Number(res.rows[0].version), changes: { state: newState }, editedBy: editedBy ?? null });
    return mapRowToPolicy(res.rows[0]);
  } catch (err) {
    logger.error('setPolicyState failed', err);
    throw err;
  }
}

/**
 * Record policy change into policy_history table.
 */
export async function recordPolicyHistory(policyId: string, opts: { version: number; changes: any; editedBy?: string | null }): Promise<void> {
  const sql = `
    INSERT INTO policy_history (policy_id, version, changes, edited_by)
    VALUES ($1, $2, $3::jsonb, $4)
  `;
  try {
    await query(sql, [policyId, opts.version, JSON.stringify(opts.changes ?? {}), opts.editedBy ?? null]);
  } catch (err) {
    logger.warn('recordPolicyHistory failed', err);
    // do not fail the main flow for history write failures
  }
}

export default {
  createPolicy,
  getPolicyById,
  getLatestPolicyByName,
  createPolicyNewVersion,
  updatePolicyInPlace,
  listPolicies,
  setPolicyState,
  recordPolicyHistory,
};

