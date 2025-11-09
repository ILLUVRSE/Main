// agent-manager/server/sandbox_worker.js
// Minimal Sandbox Worker (MVP simulation)
// - Polls sandbox_runs for status='queued'
// - Claims a run by updating to status='running' and setting started_at
// - Simulates a run (sleep + generate fake logs/results)
// - Updates the run row with logs, test_results, artifacts, finished_at, and status
// - Emits audit events via audit_signer.createSignedAuditEvent when possible
//
// NOTE: This is a simple single-worker simulator for local/dev testing.
// For production: replace simulation with an isolated container runtime, resource limits,
// proper locking (FOR UPDATE SKIP LOCKED) and better failure handling.

const db = require('./db');
const auditSigner = require('./audit_signer');
const { v4: uuidv4 } = require('uuid');

const POLL_INTERVAL_MS = Number(process.env.SANDBOX_POLL_MS || 2000);
const SIMULATED_RUN_SECONDS = Number(process.env.SIMULATED_RUN_SECONDS || 3);

let shuttingDown = false;

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function claimQueuedRun() {
  // Find one queued run
  const findQ = `SELECT run_id, agent_id FROM sandbox_runs WHERE status = 'queued' ORDER BY started_at NULLS FIRST LIMIT 1`;
  const found = await db.query(findQ);
  if (!found.rows || found.rows.length === 0) return null;
  const { run_id, agent_id } = found.rows[0];

  // Try to atomically mark as running. If another worker claimed, rowcount will be 0.
  const claimQ = `
    UPDATE sandbox_runs
    SET status = 'running', started_at = now()
    WHERE run_id = $1 AND status = 'queued'
    RETURNING *
  `;
  const res = await db.query(claimQ, [run_id]);
  if (!res.rows || res.rows.length === 0) {
    // someone else claimed it
    return null;
  }
  return res.rows[0];
}

async function finishRun(runId, status, logs = '', testResults = {}, artifacts = []) {
  const q = `
    UPDATE sandbox_runs
    SET status = $1, logs = $2, test_results = $3, artifacts = $4, finished_at = now()
    WHERE run_id = $5
    RETURNING *
  `;
  const res = await db.query(q, [status, logs, testResults, artifacts, runId]);
  return res.rows[0];
}

async function safeEmitAuditEvent(actorId, eventType, payload) {
  try {
    const ev = await auditSigner.createSignedAuditEvent(actorId, eventType, payload);
    console.log('AUDIT_EVENT_WORKER_SIGNED:', ev);
    return ev;
  } catch (e) {
    console.error('AUDIT_SIGNER error, falling back to db.createAuditEvent', e);
    try {
      const ev2 = await db.createAuditEvent(actorId, eventType, payload, null, null, null);
      console.log('AUDIT_EVENT_WORKER_DB_FALLBACK:', ev2);
      return ev2;
    } catch (e2) {
      console.error('AUDIT_EVENT_WORKER fallback failed', e2);
      return null;
    }
  }
}

async function processRun(row) {
  const runId = row.run_id;
  const agentId = row.agent_id;
  console.log(`Claimed run ${runId} for agent ${agentId}. Simulating run...`);

  // Emit audit event: sandbox run started (signed if possible)
  await safeEmitAuditEvent('sandbox-worker', 'sandbox_run_started', { run_id: runId, agent_id: agentId });

  // Simulate running tests
  const start = new Date();
  await sleep(SIMULATED_RUN_SECONDS * 1000);

  // Fake logs + results
  const logs = [
    `[${new Date().toISOString()}] Sandbox runner: starting run ${runId}`,
    `[${new Date().toISOString()}] Executing test: smoke`,
    `[${new Date().toISOString()}] Test smoke: PASS`,
    `[${new Date().toISOString()}] Run completed successfully`
  ].join('\n');

  const testResults = { smoke: { passed: true, duration_seconds: SIMULATED_RUN_SECONDS } };
  const artifacts = [{ name: 'bundle.tgz', url: `s3://local-sandbox/${agentId}/${runId}/bundle.tgz` }];

  // Mark finished
  const finished = await finishRun(runId, 'passed', logs, testResults, artifacts);
  console.log(`Run ${runId} finished: status=${finished.status}`);

  // Emit audit event: sandbox run finished (signed if possible)
  await safeEmitAuditEvent('sandbox-worker', 'sandbox_run_finished', { run_id: runId, agent_id: agentId, status: finished.status });
}

async function loop() {
  try {
    console.log('Sandbox worker starting. Poll interval ms=', POLL_INTERVAL_MS);
    // ensure DB initialized
    db.init();
    // quick test query
    await db.query('SELECT 1');

    while (!shuttingDown) {
      try {
        const claimed = await claimQueuedRun();
        if (claimed) {
          // Process the run (no concurrency in this simple worker)
          await processRun(claimed);
        } else {
          // nothing to do, sleep
          await sleep(POLL_INTERVAL_MS);
        }
      } catch (innerErr) {
        console.error('Error processing sandbox run:', innerErr);
        // brief backoff
        await sleep(1000);
      }
    }
    console.log('Sandbox worker shutting down gracefully.');
  } catch (err) {
    console.error('Sandbox worker failed to start:', err);
    process.exit(1);
  } finally {
    try { await db.close(); } catch (e) {}
  }
}

process.on('SIGINT', () => { shuttingDown = true; });
process.on('SIGTERM', () => { shuttingDown = true; });

loop();

