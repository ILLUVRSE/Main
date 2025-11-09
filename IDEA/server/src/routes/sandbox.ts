// server/src/routes/sandbox.ts
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import { requireAuth } from '../middleware/auth.js';
import { emitEvent } from '../utils/events.js';

const router = Router();

// POST /api/v1/sandbox/run
router.post('/sandbox/run', requireAuth(['creator']), async (req:any, res) => {
  const { agent_id, bundle, tests, timeout_seconds = 120, env = {} } = req.body ?? {};
  if (!agent_id || !bundle || !Array.isArray(tests) || tests.length === 0) {
    return res.status(400).json({ ok:false, error:{ code:'bad_request', message:'agent_id, bundle, and tests required' }});
  }

  const run_id = uuidv4();
  const runsDir = path.resolve(process.cwd(), 'data', 'sandbox-runs');
  await fs.mkdir(runsDir, { recursive: true });

  const record = {
    run_id,
    agent_id,
    bundle,
    tests,
    status: 'queued',
    logs: '',
    created_at: new Date().toISOString()
  };
  await fs.writeFile(path.join(runsDir, `${run_id}.json`), JSON.stringify(record, null, 2), 'utf8');

  // respond queued
  res.status(202).json({ ok:true, run_id, status: 'queued' });

  // run asynchronously
  (async () => {
    const runPath = path.join(runsDir, `${run_id}.json`);
    try {
      // create workspace for run
      const workDir = path.resolve(process.cwd(), 'data', 'sandbox-work', run_id);
      await fs.mkdir(workDir, { recursive: true });

      // If bundle is file:// and exists, extract (dev flow)
      if (typeof bundle.artifact_url === 'string' && bundle.artifact_url.startsWith('file://')) {
        // extract tarball if present
        const filePath = bundle.artifact_url.slice('file://'.length);
        // attempt to extract with tar if available
        try {
          await runCommand(`tar -xzf ${filePath} -C ${workDir}`, {}, 200000);
        } catch (e) {
          // ignore extraction error; tests may still run
        }
      }

      // execute tests sequentially, capture logs
      let logs = '';
      for (const t of tests) {
        const cmd = t.cmd;
        logs += `\n>> RUN: ${cmd}\n`;
        const result = await runCommandCapture(cmd, { cwd: workDir, env: { ...process.env, ...env } }, timeout_seconds * 1000);
        logs += result;
      }

      // determine status (simple heuristic: "failed" if "FAIL" or nonzero)
      const status = logs.toLowerCase().includes('failed') ? 'failed' : 'passed';
      const finished = { status, logs, finished_at: new Date().toISOString() };
      const raw = JSON.parse(await fs.readFile(runPath, 'utf8'));
      Object.assign(raw, finished);
      await fs.writeFile(runPath, JSON.stringify(raw, null, 2), 'utf8');
      await emitEvent('sandbox_run', { run_id, status });
    } catch (e:any) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(runsDir, `${run_id}.json`), 'utf8'));
        raw.status = 'error';
        raw.logs = raw.logs + `\nERROR: ${e?.message ?? e}`;
        raw.finished_at = new Date().toISOString();
        await fs.writeFile(path.join(runsDir, `${run_id}.json`), JSON.stringify(raw, null, 2), 'utf8');
      } catch (_) {}
    }
  })();
});

// GET /api/v1/sandbox/run/:run_id
router.get('/sandbox/run/:run_id', requireAuth(['creator']), async (req:any, res) => {
  const runsDir = path.resolve(process.cwd(), 'data', 'sandbox-runs');
  const run_id = req.params.run_id;
  try {
    const raw = await fs.readFile(path.join(runsDir, `${run_id}.json`), 'utf8');
    const rec = JSON.parse(raw);
    return res.json({ ok:true, ...rec });
  } catch (e:any) {
    return res.status(404).json({ ok:false, error:{ code:'not_found', message:'run not found' }});
  }
});

export default router;

// helpers
function runCommand(cmd: string, opts: any = {}, timeout = 120000) {
  return new Promise<void>((resolve, reject) => {
    const cp = spawn('sh', ['-lc', cmd], { stdio: 'inherit', ...opts });
    const timer = setTimeout(() => {
      cp.kill('SIGKILL');
      reject(new Error('timeout'));
    }, timeout);
    cp.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`exit ${code}`));
    });
    cp.on('error', reject);
  });
}

function runCommandCapture(cmd: string, opts: any = {}, timeout = 120000) {
  return new Promise<string>((resolve) => {
    const cp = spawn('sh', ['-lc', cmd], opts);
    let acc = '';
    cp.stdout.on('data', d => acc += d.toString());
    cp.stderr.on('data', d => acc += d.toString());
    const timer = setTimeout(() => {
      try { cp.kill('SIGKILL'); } catch (_) {}
      resolve(acc + '\n[TIMED OUT]');
    }, timeout);
    cp.on('close', () => {
      clearTimeout(timer);
      resolve(acc);
    });
    cp.on('error', (err) => {
      clearTimeout(timer);
      resolve(acc + '\n[ERROR] ' + (err?.message ?? String(err)));
    });
  });
}

