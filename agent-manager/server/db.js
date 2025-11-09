// agent-manager/server/db.js
// Minimal Postgres helper for Agent Manager
//
// Exports:
//  - init()            -> initialize pool (auto-called on first query)
//  - close()           -> close pool
//  - createAgent(record)
//  - getAgent(agent_id)
//  - updateAgentStatus(agent_id, status, last_seen)
//  - createTemplate(name, description, config)
//  - listTemplates()
//  - createAuditEvent(actor_id, event_type, payload, signature, signer_kid, prev_hash)
//  - createSandboxRun(run)
//  - getSandboxRun(run_id)
//  - query(text, params)
//
// Kernel nonce helpers (for DB-backed replay protection):
//  - insertKernelNonce(nonce, expiresAtIso, agentId = null)
//      -> tries to insert a nonce row; returns the inserted row or null if conflict
//  - getKernelNonce(nonce) -> returns row or null
//  - consumeKernelNonce(nonce, consumedBy = null) -> marks consumed_at if not already consumed; returns updated row or null
//  - isKernelNonceReplay(nonce) -> boolean: true==replay (exists & not expired or consumed), false==not replay

const { Pool } = require('pg');

let pool = null;

function ensurePool() {
  if (pool) return pool;
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    throw new Error('DATABASE_URL is not set. Set it to a Postgres connection string before using DB.');
  }
  pool = new Pool({ connectionString: conn });
  return pool;
}

async function close() {
  if (!pool) return;
  await pool.end();
  pool = null;
}

/* Generic query helper */
async function query(text, params = []) {
  const p = ensurePool();
  const res = await p.query(text, params);
  return res;
}

/* Agents */
async function createAgent(record = {}) {
  // record: { agent_id?, name, profile, status, created_by, created_at, latest_manifest, metadata, last_seen }
  const {
    agent_id, name, profile, status = 'initializing', created_by = null,
    created_at = new Date().toISOString(), latest_manifest = null, metadata = null, last_seen = null
  } = record;

  if (agent_id) {
    const q = `
      INSERT INTO agents (agent_id, name, profile, status, created_by, created_at, latest_manifest, metadata, last_seen)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (agent_id) DO NOTHING
      RETURNING agent_id
    `;
    const res = await query(q, [agent_id, name, profile, status, created_by, created_at, latest_manifest, metadata, last_seen]);
    return res.rows[0] ? res.rows[0].agent_id : agent_id;
  } else {
    const q = `
      INSERT INTO agents (name, profile, status, created_by, created_at, latest_manifest, metadata, last_seen)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING agent_id
    `;
    const res = await query(q, [name, profile, status, created_by, created_at, latest_manifest, metadata, last_seen]);
    return res.rows[0].agent_id;
  }
}

async function getAgent(agent_id) {
  const q = `SELECT * FROM agents WHERE agent_id = $1`;
  const res = await query(q, [agent_id]);
  return res.rows[0] || null;
}

async function updateAgentStatus(agent_id, status, last_seen = new Date().toISOString()) {
  const q = `
    UPDATE agents
    SET status = $1, last_seen = $2
    WHERE agent_id = $3
    RETURNING *
  `;
  const res = await query(q, [status, last_seen, agent_id]);
  return res.rows[0] || null;
}

/* Templates */
async function createTemplate(name, description = null, config = {}) {
  const q = `
    INSERT INTO templates (name, description, config, created_at)
    VALUES ($1, $2, $3, now())
    RETURNING template_id
  `;
  const res = await query(q, [name, description, config]);
  return res.rows[0].template_id;
}

async function listTemplates(limit = 100) {
  const q = `SELECT * FROM templates ORDER BY created_at DESC LIMIT $1`;
  const res = await query(q, [limit]);
  return res.rows;
}

/* Audit events */
async function createAuditEvent(actor_id = null, event_type, payload = {}, signature = null, signer_kid = null, prev_hash = null) {
  const q = `
    INSERT INTO audit_events (actor_id, event_type, payload, signature, signer_kid, prev_hash, created_at)
    VALUES ($1,$2,$3,$4,$5,$6, now())
    RETURNING id, created_at
  `;
  const res = await query(q, [actor_id, event_type, payload, signature, signer_kid, prev_hash]);
  return res.rows[0];
}

/* Sandbox runs */
async function createSandboxRun({ agent_id, status = 'queued', logs = null, test_results = null, artifacts = null, started_at = null, finished_at = null }) {
  const q = `
    INSERT INTO sandbox_runs (agent_id, status, logs, test_results, artifacts, started_at, finished_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING run_id
  `;
  const res = await query(q, [agent_id, status, logs, test_results, artifacts, started_at, finished_at]);
  return res.rows[0].run_id;
}

async function getSandboxRun(run_id) {
  const q = `SELECT * FROM sandbox_runs WHERE run_id = $1`;
  const res = await query(q, [run_id]);
  return res.rows[0] || null;
}

/* Kernel nonces: DB-backed replay protection helpers */

/**
 * insertKernelNonce
 * Try to insert a kernel nonce row. The table schema has a UNIQUE constraint
 * on nonce, so concurrent inserts will result in only one success.
 *
 * @param {string} nonce - the opaque nonce string
 * @param {string} expiresAtIso - ISO timestamp when this nonce should be considered expired (timestamptz)
 * @param {string|null} agentId - optional agent_uuid associated with this nonce
 * @returns {object|null} - inserted row { id, nonce, agent_id, created_at, expires_at, consumed_at, consumed_by } or null on conflict
 */
async function insertKernelNonce(nonce, expiresAtIso, agentId = null) {
  const q = `
    INSERT INTO kernel_nonces (nonce, agent_id, expires_at, created_at)
    VALUES ($1, $2, $3, now())
    ON CONFLICT (nonce) DO NOTHING
    RETURNING id, nonce, agent_id, created_at, expires_at, consumed_at, consumed_by
  `;
  const res = await query(q, [nonce, agentId, expiresAtIso]);
  return res.rows[0] || null;
}

/**
 * getKernelNonce
 * Fetch the nonce row if present.
 * @param {string} nonce
 * @returns {object|null}
 */
async function getKernelNonce(nonce) {
  const q = `SELECT id, nonce, agent_id, created_at, expires_at, consumed_at, consumed_by FROM kernel_nonces WHERE nonce = $1`;
  const res = await query(q, [nonce]);
  return res.rows[0] || null;
}

/**
 * consumeKernelNonce
 * Atomically mark a nonce as consumed (consumed_at=now()) only if it wasn't consumed before.
 * Returns the updated row or null if the nonce was not found or already consumed.
 *
 * @param {string} nonce
 * @param {string|null} consumedBy
 * @returns {object|null}
 */
async function consumeKernelNonce(nonce, consumedBy = null) {
  const q = `
    UPDATE kernel_nonces
    SET consumed_at = now(), consumed_by = $2
    WHERE nonce = $1 AND consumed_at IS NULL
    RETURNING id, nonce, agent_id, created_at, expires_at, consumed_at, consumed_by
  `;
  const res = await query(q, [nonce, consumedBy]);
  return res.rows[0] || null;
}

/**
 * isKernelNonceReplay
 * Returns true if the nonce is considered a replay:
 *   - nonce exists AND
 *     - consumed_at IS NOT NULL  => replay (already consumed)
 *     - OR expires_at is in the future AND not consumed => replay
 * Returns false if:
 *   - nonce does not exist
 *   - OR nonce exists but has expired
 *
 * NOTE: this function does not mutate DB. Recommended pattern for middleware:
 *   1) attempt insertKernelNonce(nonce, expiresAtIso) -> if inserted -> OK (not replay)
 *   2) else (conflict) call isKernelNonceReplay(nonce) -> if true => replay, else -> treat as not replay (expired)
 *
 * @param {string} nonce
 * @returns {boolean}
 */
async function isKernelNonceReplay(nonce) {
  const row = await getKernelNonce(nonce);
  if (!row) return false;

  // consumed => replay
  if (row.consumed_at) return true;

  // if expires_at is set and is in the past => not a replay (treated as expired)
  if (row.expires_at) {
    const expires = new Date(row.expires_at);
    const now = new Date();
    if (expires < now) return false;
    // not expired and not consumed => replay
    return true;
  }

  // If no expires_at present (shouldn't happen), treat as replay
  return true;
}

module.exports = {
  init: ensurePool,
  close,
  query,
  createAgent,
  getAgent,
  updateAgentStatus,
  createTemplate,
  listTemplates,
  createAuditEvent,
  createSandboxRun,
  getSandboxRun,

  // Kernel nonce helpers
  insertKernelNonce,
  getKernelNonce,
  consumeKernelNonce,
  isKernelNonceReplay,
};

