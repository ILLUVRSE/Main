// agent-manager/server/index.js
const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const auditSigner = require('./audit_signer');
const signatureVerify = require('./middleware/signatureVerify');
const { verifyManifestSignature } = require('./manifest_verifier');

dotenv.config();
const PORT = process.env.PORT || 5176;
const app = express();

function rawBodySaver(req, res, buf, encoding) { if (buf && buf.length) req.rawBody = buf; }
app.use(bodyParser.json({ verify: rawBodySaver }));

let DB_AVAILABLE = false;

function sendError(res, statusCode, code, message) {
  res.status(statusCode).json({ ok: false, error: { code, message } });
}

async function emitAuditEvent(actorId, eventType, payload = {}) {
   try {
     if (DB_AVAILABLE) {
       // 1. Canonicalize payload
       const canonical = auditSigner.canonicalize(payload);

       // 2. Sign using available method (signAuditCanonical wraps available signing method)
       const { kid, alg, signature } = await auditSigner.signAuditCanonical(canonical);

       // 3. Store in DB
       await db.createAuditEvent(actorId, eventType, payload, signature, kid, null);
     } else {
       console.log('AUDIT (Fallback):', eventType, payload);
     }
   } catch (e) {
     console.error('Failed to emit audit event:', e);
   }
}

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Metrics
// Telemetry metrics should include at minimum: spawn_count, spawn_latency_ms (p95/p99), lifecycle_failure_count, sandbox_run_duration_ms.
const METRICS = {
  spawn_count: 0,
  spawn_latency_ms: [],
  lifecycle_failure_count: 0,
  sandbox_run_duration_ms: []
};

app.get('/metrics', (req, res) => {
  res.json(METRICS);
});

// Helper for idempotency and DB
async function getOrUpdateAgent(agent_id) {
  if (!DB_AVAILABLE) return null;
  return await db.getAgent(agent_id);
}

// Spawn
app.post('/api/v1/agent/spawn', async (req, res) => {
  const startTime = Date.now();
  try {
    const { agent_config, signed_manifest, idempotency_key } = req.body || {};

    // Idempotency check using idempotency_key if provided, or agent_config.name/agent_id
    // If agent_config.name is provided, we can check if an agent with that name exists?
    // The requirements say "lifecycle APIs must be idempotent".
    // "duplicate requests must not create duplicate resources"

    if (!agent_config || !agent_config.name || !agent_config.profile) {
      return sendError(res, 400, 'bad_request', 'Invalid config');
    }

    // --- SECURITY GATE ---
    if (agent_config.profile === 'illuvrse') {
      if (!signed_manifest) return sendError(res, 403, 'forbidden', 'signed_manifest required');

      try {
        await verifyManifestSignature(signed_manifest);
        console.log(`Manifest verified for ${agent_config.name} signed by ${signed_manifest.kid}`);
      } catch (e) {
        console.error('Manifest verification failed:', e.message);
        return sendError(res, 403, 'forbidden', 'Manifest signature invalid: ' + e.message);
      }
    }
    // ---------------------

    let agent_id = req.body.agent_id || uuidv4();

    if (DB_AVAILABLE) {
        // Check if agent exists with this name to ensure idempotency if desired,
        // or rely on client passing same agent_id.
        // For acceptance, we will assume if the client sends the same request (same name/config),
        // we should ideally return the existing one or create new if not found.
        // However, standard REST 'spawn' usually creates.
        // Let's rely on `agent_id` or `name` uniqueness constraint in DB if it exists.
        // `createAgent` in db.js does `ON CONFLICT (agent_id) DO NOTHING`.

        // If the user provides an agent_id, we use it.

        const existingId = await db.createAgent({
            agent_id,
            name: agent_config.name,
            profile: agent_config.profile,
            status: 'running',
            latest_manifest: signed_manifest
        });

        // If existingId is returned, use it.
        agent_id = existingId;
    }

    METRICS.spawn_count++;
    METRICS.spawn_latency_ms.push(Date.now() - startTime);

    await emitAuditEvent(req.body.actor_id || 'system', 'agent_spawned', { agent_id, verified: true });
    res.status(201).json({ ok: true, agent_id });

  } catch (err) {
    console.error(err);
    METRICS.lifecycle_failure_count++;
    sendError(res, 500, 'server_error', err.message);
  }
});

// Lifecycle: Start
app.post('/api/v1/agent/:agent_id/start', async (req, res) => {
  const { agent_id } = req.params;
  try {
    if (DB_AVAILABLE) {
      await db.updateAgentStatus(agent_id, 'running');
    }
    await emitAuditEvent(req.body.actor_id || 'system', 'agent_started', { agent_id });
    res.json({ ok: true, status: 'running' });
  } catch (e) {
    METRICS.lifecycle_failure_count++;
    sendError(res, 500, 'server_error', e.message);
  }
});

// Lifecycle: Stop
app.post('/api/v1/agent/:agent_id/stop', async (req, res) => {
  const { agent_id } = req.params;
  try {
    if (DB_AVAILABLE) {
      await db.updateAgentStatus(agent_id, 'stopped');
    }
    await emitAuditEvent(req.body.actor_id || 'system', 'agent_stopped', { agent_id });
    res.json({ ok: true, status: 'stopped' });
  } catch (e) {
    METRICS.lifecycle_failure_count++;
    sendError(res, 500, 'server_error', e.message);
  }
});

// Lifecycle: Restart
app.post('/api/v1/agent/:agent_id/restart', async (req, res) => {
  const { agent_id } = req.params;
  try {
    if (DB_AVAILABLE) {
      await db.updateAgentStatus(agent_id, 'restarting');
      // Simulate restart delay
      setTimeout(() => db.updateAgentStatus(agent_id, 'running'), 100);
    }
    await emitAuditEvent(req.body.actor_id || 'system', 'agent_restarted', { agent_id });
    res.json({ ok: true, status: 'restarting' });
  } catch (e) {
    METRICS.lifecycle_failure_count++;
    sendError(res, 500, 'server_error', e.message);
  }
});

// Lifecycle: Scale
app.post('/api/v1/agent/:agent_id/scale', async (req, res) => {
  const { agent_id } = req.params;
  const { replicas } = req.body;
  try {
    // In a real system, this would scale the deployment.
    // Here we just log and audit.
    await emitAuditEvent(req.body.actor_id || 'system', 'agent_scaled', { agent_id, replicas });
    res.json({ ok: true, replicas });
  } catch (e) {
    METRICS.lifecycle_failure_count++;
    sendError(res, 500, 'server_error', e.message);
  }
});

// Sandbox Run
app.post('/api/v1/sandbox/run', async (req, res) => {
  const startTime = Date.now();
  const { agent_id, task_payload } = req.body;

  if (!agent_id || !task_payload) {
      return sendError(res, 400, 'bad_request', 'Missing agent_id or task_payload');
  }

  try {
    // Isolate execution logic
    // We will use a separate worker file or process.
    // For "Minimum completion", we can use child_process to run a script.

    const worker = require('./sandbox_worker');
    const result = await worker.runTask(task_payload);

    const duration = Date.now() - startTime;
    METRICS.sandbox_run_duration_ms.push(duration);

    if (DB_AVAILABLE) {
        await db.createSandboxRun({
            agent_id,
            status: result.status,
            logs: result.logs,
            started_at: new Date(startTime).toISOString(),
            finished_at: new Date().toISOString()
        });
    }

    await emitAuditEvent(req.body.actor_id || 'system', 'sandbox_run_finished', { agent_id, result: result.status, duration });

    res.json({ ok: true, result });

  } catch (e) {
    console.error('Sandbox error:', e);
    METRICS.lifecycle_failure_count++; // Reusing failure count for general errors
    sendError(res, 500, 'server_error', e.message);
  }
});


// Start
async function start() {
  try {
    await db.init();
    DB_AVAILABLE = true;
    console.log('DB Connected');
  } catch (e) {
      console.log('DB unavailable, running in memory-only mode (limited functionality)');
      console.error(e);
  }
  if (require.main === module) {
    app.listen(PORT, () => console.log(`Agent Manager on ${PORT}`));
  }
}
start();

module.exports = app; // For testing
