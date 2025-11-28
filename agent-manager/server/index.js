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

const IDEMPOTENCY = new Map();
let IN_MEMORY_AGENTS = new Map();
let DB_AVAILABLE = false;

function sendError(res, statusCode, code, message) {
  res.status(statusCode).json({ ok: false, error: { code, message } });
}

async function emitAuditEvent(actorId, eventType, payload = {}) {
   // Simplified for brevity - assumes DB available usually
   if (DB_AVAILABLE) await auditSigner.createSignedAuditEvent(actorId, eventType, payload);
   else console.log('AUDIT (Fallback):', eventType, payload);
}

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Spawn
app.post('/api/v1/agent/spawn', async (req, res) => {
  try {
    const { agent_config, signed_manifest } = req.body || {};
    if (!agent_config || !agent_config.name || !agent_config.profile) {
      return sendError(res, 400, 'bad_request', 'Invalid config');
    }

    // --- SECURITY GATE ---
    if (agent_config.profile === 'illuvrse') {
      if (!signed_manifest) return sendError(res, 403, 'forbidden', 'signed_manifest required');

      try {
        await verifyManifestSignature(signedManifest);
        console.log(`Manifest verified for ${agent_config.name} signed by ${signed_manifest.kid}`);
      } catch (e) {
        console.error('Manifest verification failed:', e.message);
        return sendError(res, 403, 'forbidden', 'Manifest signature invalid: ' + e.message);
      }
    }
    // ---------------------

    const agent_id = uuidv4();
    // (Actual spawn logic omitted for brevity in this patch script, assuming simplified behavior)
    if (DB_AVAILABLE) {
       await db.createAgent({ agent_id, name: agent_config.name, status: 'initializing' });
    }

    emitAuditEvent(req.body.actor_id, 'agent_spawned', { agent_id, verified: true });
    res.status(201).json({ ok: true, agent_id });

  } catch (err) {
    console.error(err);
    sendError(res, 500, 'server_error', err.message);
  }
});

// Start
async function start() {
  try {
    await db.init();
    DB_AVAILABLE = true;
  } catch (e) { console.log('DB unavailable'); }
  app.listen(PORT, () => console.log(`Agent Manager on ${PORT}`));
}
start();
