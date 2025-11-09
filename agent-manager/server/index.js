// agent-manager/server/index.js
// Agent Manager server (Postgres-backed, with in-memory fallback)
// Adds endpoints for sandbox run creation and retrieval and Kernel callback verification.

const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');

dotenv.config();

const PORT = process.env.PORT || 5176;

const db = require('./db');
const signatureVerify = require('./middleware/signatureVerify');

const app = express();

// capture raw body for signature verification
function rawBodySaver(req, res, buf, encoding) {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
}
app.use(bodyParser.json({ verify: rawBodySaver }));

// In-memory idempotency and minimal agent cache for fallback
const IDEMPOTENCY = new Map();
let IN_MEMORY_AGENTS = new Map(); // used only if DB unavailable
let IN_MEMORY_SANDBOX = new Map(); // run_id -> run object
let DB_AVAILABLE = false;

/* Helper: error response (consistent format) */
function sendError(res, statusCode, code, message, details = null) {
  const payload = { ok: false, error: { code, message } };
  if (details) payload.error.details = details;
  return res.status(statusCode).json(payload);
}

/* Emit audit event: try DB, otherwise console log */
async function emitAuditEvent(actorId, eventType, payload = {}, signature = null, signerKid = null, prevHash = null) {
  try {
    if (DB_AVAILABLE) {
      const ev = await db.createAuditEvent(actorId, eventType, payload, signature, signerKid, prevHash);
      console.log('AUDIT_EVENT_DB:', ev);
      return ev;
    } else {
      const ev = {
        id: uuidv4(),
        actor_id: actorId || 'system',
        event_type: eventType,
        payload,
        created_at: new Date().toISOString()
      };
      console.log('AUDIT_EVENT_FALLBACK:', JSON.stringify(ev));
      return ev;
    }
  } catch (err) {
    console.error('Failed to emit audit event', err);
    // still return lightweight event
    return {
      id: uuidv4(),
      actor_id: actorId || 'system',
      event_type: eventType,
      payload,
      created_at: new Date().toISOString()
    };
  }
}

/* Health endpoints */
app.get('/health', (req, res) => res.json({ ok: true, status: 'pass', ts: new Date().toISOString() }));
app.get('/ready', (req, res) => res.json({ ok: DB_AVAILABLE, ready: DB_AVAILABLE }));

/* Templates */
app.get('/api/v1/agent/templates', async (req, res) => {
  try {
    if (DB_AVAILABLE) {
      const list = await db.listTemplates();
      return res.json({ ok: true, templates: list });
    } else {
      const list = Array.from(IN_MEMORY_AGENTS.values()); // fallback empty-ish
      return res.json({ ok: true, templates: list.slice(0, 100) });
    }
  } catch (err) {
    console.error('templates list error', err);
    return sendError(res, 500, 'server_error', 'failed to list templates');
  }
});

app.post('/api/v1/agent/templates', async (req, res) => {
  try {
    const { name, description, config } = req.body || {};
    if (!name || !config) return sendError(res, 400, 'bad_request', 'name and config are required');
    if (DB_AVAILABLE) {
      const template_id = await db.createTemplate(name, description || null, config);
      await emitAuditEvent(req.body?.actor_id || 'unknown', 'template_created', { template_id, name });
      return res.status(201).json({ ok: true, template_id });
    } else {
      // fallback: create in-memory template store on IN_MEMORY_AGENTS
      const template_id = uuidv4();
      IN_MEMORY_AGENTS.set(template_id, { template_id, name, description, config, created_at: new Date().toISOString() });
      await emitAuditEvent(req.body?.actor_id || 'unknown', 'template_created', { template_id, name });
      return res.status(201).json({ ok: true, template_id });
    }
  } catch (err) {
    console.error('create template error', err);
    return sendError(res, 500, 'server_error', 'failed to create template');
  }
});

/* Spawn / register agent */
app.post('/api/v1/agent/spawn', async (req, res) => {
  try {
    const idempotencyKey = (req.get('Idempotency-Key') || '').trim();
    if (idempotencyKey && IDEMPOTENCY.has(idempotencyKey)) {
      return res.status(200).json(IDEMPOTENCY.get(idempotencyKey));
    }

    const { agent_config, signed_manifest } = req.body || {};
    if (!agent_config || typeof agent_config !== 'object') {
      return sendError(res, 400, 'bad_request', 'agent_config object required');
    }
    if (!agent_config.name || typeof agent_config.name !== 'string') {
      return sendError(res, 400, 'bad_request', 'agent_config.name required');
    }
    if (!agent_config.profile || typeof agent_config.profile !== 'string') {
      return sendError(res, 400, 'bad_request', 'agent_config.profile required');
    }

    // enforce signed_manifest for production profile
    if (String(agent_config.profile) === 'illuvrse' && !signed_manifest) {
      return sendError(res, 403, 'forbidden', 'signed_manifest required for illuvrse profile');
    }

    const now = new Date().toISOString();
    const record = {
      agent_id: agent_config.agent_id || undefined,
      name: agent_config.name,
      profile: agent_config.profile,
      status: 'initializing',
      metadata: agent_config.metadata || {},
      created_by: agent_config.metadata?.owner || req.body?.actor_id || 'unknown',
      created_at: now,
      latest_manifest: signed_manifest || null,
      last_seen: now
    };

    let agent_id;
    if (DB_AVAILABLE) {
      agent_id = await db.createAgent(record);
      const dbAgent = await db.getAgent(agent_id);
      await emitAuditEvent(record.created_by, 'agent_created', { agent_id, name: record.name, profile: record.profile });
    } else {
      agent_id = record.agent_id || uuidv4();
      record.agent_id = agent_id;
      IN_MEMORY_AGENTS.set(agent_id, record);
      await emitAuditEvent(record.created_by, 'agent_created', { agent_id, name: record.name, profile: record.profile });
    }

    const resp = { ok: true, agent_id, status: 'initializing' };
    if (idempotencyKey) IDEMPOTENCY.set(idempotencyKey, resp);

    return res.status(201).json(resp);
  } catch (err) {
    console.error('spawn error', err);
    return sendError(res, 500, 'server_error', 'internal error during spawn');
  }
});

/* Agent status */
app.get('/api/v1/agent/:id/status', async (req, res) => {
  try {
    const agent_id = req.params.id;
    if (DB_AVAILABLE) {
      const r = await db.getAgent(agent_id);
      if (!r) return sendError(res, 404, 'not_found', 'agent not found');
      const agent_manager_status = { state: r.status, last_seen: r.last_seen || null };
      return res.json({ ok: true, agent_id: r.agent_id, status: r.status, agent_manager_status, latest_manifest: r.latest_manifest });
    } else {
      const r = IN_MEMORY_AGENTS.get(agent_id);
      if (!r) return sendError(res, 404, 'not_found', 'agent not found');
      const agent_manager_status = { state: r.status, last_seen: r.last_seen || null };
      return res.json({ ok: true, agent_id: r.agent_id, status: r.status, agent_manager_status, latest_manifest: r.latest_manifest });
    }
  } catch (err) {
    console.error('status error', err);
    return sendError(res, 500, 'server_error', 'failed to retrieve agent status');
  }
});

/* Agent action (start/stop/restart/scale) */
app.post('/api/v1/agent/:id/action', async (req, res) => {
  try {
    const agent_id = req.params.id;
    const { action, scale } = req.body || {};
    if (!action || !['start', 'stop', 'restart', 'scale'].includes(action)) {
      return sendError(res, 400, 'bad_request', 'action must be one of start|stop|restart|scale');
    }

    if (DB_AVAILABLE) {
      const agent = await db.getAgent(agent_id);
      if (!agent) return sendError(res, 404, 'not_found', 'agent not found');

      let newStatus = agent.status;
      if (action === 'start') newStatus = 'running';
      else if (action === 'stop') newStatus = 'stopped';
      else if (action === 'restart') { newStatus = 'restarting'; newStatus = 'running'; }
      else if (action === 'scale') {
        if (!scale || typeof scale.replicas !== 'number') return sendError(res, 400, 'bad_request', 'scale requires { replicas: number }');
        newStatus = `running (replicas=${scale.replicas})`;
      }

      const updated = await db.updateAgentStatus(agent_id, newStatus, new Date().toISOString());
      await emitAuditEvent(req.body?.actor_id || 'unknown', 'agent_action', { agent_id, action, scale });
      return res.json({ ok: true, agent_id: updated.agent_id, status: updated.status });
    } else {
      const r = IN_MEMORY_AGENTS.get(agent_id);
      if (!r) return sendError(res, 404, 'not_found', 'agent not found');

      if (action === 'start') r.status = 'running';
      else if (action === 'stop') r.status = 'stopped';
      else if (action === 'restart') { r.status = 'restarting'; r.status = 'running'; }
      else if (action === 'scale') {
        if (!scale || typeof scale.replicas !== 'number') return sendError(res, 400, 'bad_request', 'scale requires { replicas: number }');
        r.status = `running (replicas=${scale.replicas})`;
      }
      r.last_seen = new Date().toISOString();
      IN_MEMORY_AGENTS.set(agent_id, r);
      await emitAuditEvent(req.body?.actor_id || 'unknown', 'agent_action', { agent_id, action, scale });
      return res.json({ ok: true, agent_id: r.agent_id, status: r.status });
    }
  } catch (err) {
    console.error('action error', err);
    return sendError(res, 500, 'server_error', 'failed to perform action');
  }
});

/* ---- Sandbox endpoints ---- */

/**
 * POST /api/v1/agent/:id/sandbox/run
 * Create a sandbox run for an agent (queued).
 * Body: { tests?: [ { name, cmd } ], timeout_seconds?, env?: {} }
 * Response: 202 { ok:true, run_id, status: "queued" }
 */
app.post('/api/v1/agent/:id/sandbox/run', async (req, res) => {
  try {
    const agent_id = req.params.id;
    // validate agent exists
    if (DB_AVAILABLE) {
      const agent = await db.getAgent(agent_id);
      if (!agent) return sendError(res, 404, 'not_found', 'agent not found');
    } else {
      if (!IN_MEMORY_AGENTS.has(agent_id)) return sendError(res, 404, 'not_found', 'agent not found');
    }

    const { tests = [], timeout_seconds = 120, env = {} } = req.body || {};
    const payload = { tests, timeout_seconds, env };

    if (DB_AVAILABLE) {
      const run_id = await db.createSandboxRun({ agent_id, status: 'queued', logs: null, test_results: null, artifacts: null, started_at: null, finished_at: null });
      await emitAuditEvent(req.body?.actor_id || 'unknown', 'sandbox_run_created', { run_id, agent_id, payload });
      return res.status(202).json({ ok: true, run_id, status: 'queued' });
    } else {
      const run_id = uuidv4();
      const run = { run_id, agent_id, status: 'queued', logs: null, test_results: null, artifacts: null, started_at: null, finished_at: null, payload };
      IN_MEMORY_SANDBOX.set(run_id, run);
      await emitAuditEvent(req.body?.actor_id || 'unknown', 'sandbox_run_created', { run_id, agent_id, payload });
      return res.status(202).json({ ok: true, run_id, status: 'queued' });
    }
  } catch (err) {
    console.error('sandbox create error', err);
    return sendError(res, 500, 'server_error', 'failed to create sandbox run');
  }
});

/**
 * GET /api/v1/sandbox/run/:run_id
 * Return sandbox run status/result
 */
app.get('/api/v1/sandbox/run/:run_id', async (req, res) => {
  try {
    const run_id = req.params.run_id;
    if (DB_AVAILABLE) {
      const run = await db.getSandboxRun(run_id);
      if (!run) return sendError(res, 404, 'not_found', 'sandbox run not found');
      return res.json({ ok: true, run_id: run.run_id, agent_id: run.agent_id, status: run.status, logs: run.logs, test_results: run.test_results, artifacts: run.artifacts, started_at: run.started_at, finished_at: run.finished_at });
    } else {
      const run = IN_MEMORY_SANDBOX.get(run_id);
      if (!run) return sendError(res, 404, 'not_found', 'sandbox run not found');
      return res.json({ ok: true, run_id: run.run_id, agent_id: run.agent_id, status: run.status, logs: run.logs, test_results: run.test_results, artifacts: run.artifacts, started_at: run.started_at, finished_at: run.finished_at });
    }
  } catch (err) {
    console.error('sandbox get error', err);
    return sendError(res, 500, 'server_error', 'failed to retrieve sandbox run');
  }
});

/* ---- Kernel callback endpoint ----
   Expects:
   - X-Kernel-Signature, X-Kernel-Timestamp, X-Kernel-Nonce headers (verified by signatureVerify)
   - JSON body containing validation result. Example:
     {
       "validation_id":"uuid",
       "status":"PASS" | "FAIL",
       "signed_manifest": {},
       "diagnostics": { ... },
       "timestamp": "..."
     }
*/
app.post('/api/v1/kernel/callback', signatureVerify(), async (req, res) => {
  try {
    // middleware guarantees signature verified and req.kernelSignature present
    const sigMeta = req.kernelSignature || {};
    const payload = req.body || {};
    if (!payload.validation_id) {
      return sendError(res, 400, 'bad_request', 'validation_id required');
    }
    if (!payload.status) {
      return sendError(res, 400, 'bad_request', 'status required');
    }
    // normalize status
    const rawStatus = String(payload.status).toLowerCase();
    let normalized;
    if (rawStatus === 'pass' || rawStatus === 'passed') normalized = 'PASS';
    else if (rawStatus === 'fail' || rawStatus === 'failed') normalized = 'FAIL';
    else normalized = String(payload.status).toUpperCase();

    // Persist audit event that Kernel called back
    await emitAuditEvent('kernel', 'kernel_callback_received', { validation_id: payload.validation_id, status: normalized, payload }, null, sigMeta.kid);

    // If PASS and signed_manifest present, record manifest into agents table
    if (normalized === 'PASS' && payload.signed_manifest && payload.signed_manifest.manifest && payload.signed_manifest.manifest.agent_id) {
      const agentId = payload.signed_manifest.manifest.agent_id;
      if (DB_AVAILABLE) {
        try {
          await db.query('UPDATE agents SET latest_manifest = $1, status = $2 WHERE agent_id = $3', [payload.signed_manifest, 'validated', agentId]);
          await emitAuditEvent('kernel', 'kernel_manifest_recorded', { agent_id: agentId, validation_id: payload.validation_id }, null, sigMeta.kid);
        } catch (dbErr) {
          console.error('Failed to update agent with signed_manifest', dbErr);
          // still return success to kernel, but log error
        }
      } else {
        // fallback in-memory
        const agent = IN_MEMORY_AGENTS.get(agentId);
        if (agent) {
          agent.latest_manifest = payload.signed_manifest;
          agent.status = 'validated';
          IN_MEMORY_AGENTS.set(agentId, agent);
        }
      }
    }

    return res.json({ ok: true, received_at: new Date().toISOString() });
  } catch (err) {
    console.error('kernel callback handler error', err);
    return sendError(res, 500, 'server_error', 'failed to process kernel callback');
  }
});

/* Basic not-found */
app.use((req, res) => sendError(res, 404, 'not_found', 'endpoint not found'));

/* Start server and initialize DB */
async function start() {
  try {
    try {
      db.init();
      await db.query('SELECT 1');
      DB_AVAILABLE = true;
      console.log('DB connected: using Postgres for persistence');
    } catch (err) {
      DB_AVAILABLE = false;
      console.warn('DB not available; falling back to in-memory stores. Error:', err.message || err);
    }

    app.listen(PORT, () => {
      console.log(`Agent Manager listening at http://127.0.0.1:${PORT} (db=${DB_AVAILABLE})`);
    });
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
}

/* Graceful shutdown */
async function shutdown() {
  console.log('Shutting down Agent Manager...');
  try {
    if (DB_AVAILABLE) {
      await db.close();
      console.log('DB pool closed');
    }
  } catch (err) {
    console.error('Error during DB close', err);
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/* Launch */
start();

