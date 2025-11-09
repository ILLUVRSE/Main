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
};

