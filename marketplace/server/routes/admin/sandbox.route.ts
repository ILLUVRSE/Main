/**
 * marketplace/server/routes/admin/sandbox.route.ts
 *
 * Admin endpoints for preview sandbox management (operator-only).
 *
 * Routes:
 *  GET  /admin/sandbox/pool           -> { ok:true, pool: {...} }
 *  GET  /admin/sandbox/sessions       -> { ok:true, sessions: [...] }
 *  POST /admin/sandbox/reap           -> { ok:true, result: {...} }
 *  POST /admin/sandbox/sessions/:id/stop -> { ok:true, stopped: true }
 *
 * These handlers attempt to call into `marketplace/sandbox/sandboxRunner.ts` if present.
 * If the sandboxRunner module isn't present or doesn't expose the expected helpers,
 * the endpoints return reasonable default/mocked responses so the admin UI can function
 * in dev environments.
 */

import { Router, Request, Response } from 'express';
import path from 'path';

const router = Router();

function isOperatorAuthorized(req: Request): boolean {
  const auth = String(req.header('Authorization') || '').trim();
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice('Bearer '.length).trim();
  if (!token) return false;

  const controlToken = process.env.KERNEL_CONTROL_PANEL_TOKEN || '';
  if (controlToken && token === controlToken) return true;

  // Dev convenience: allow tokens containing 'operator'
  if (process.env.NODE_ENV !== 'production' && token.toLowerCase().includes('operator')) return true;

  return false;
}

/* Helper to safely load sandboxRunner if available */
function tryRequireSandboxRunner() {
  try {
    // prefer local module path
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const runner = require(path.join(process.cwd(), 'marketplace', 'sandbox', 'sandboxRunner'));
    return runner;
  } catch {
    try {
      // fallback to relative import if running from a different cwd
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const runner = require('../../sandbox/sandboxRunner');
      return runner;
    } catch {
      return null;
    }
  }
}

/* GET /admin/sandbox/pool */
router.get('/admin/sandbox/pool', async (req: Request, res: Response) => {
  if (!isOperatorAuthorized(req)) {
    return res.status(403).json({ ok: false, error: { message: 'Operator authorization required' } });
  }

  try {
    const runner = tryRequireSandboxRunner();
    if (runner && typeof runner.getPoolConfig === 'function') {
      const pool = await runner.getPoolConfig();
      return res.json({ ok: true, pool });
    }

    // If runner not present or function missing, return a sensible default for dev
    const defaultPool = {
      pool_size: Number(process.env.SANDBOX_POOL_SIZE || 4),
      cpu_millis: Number(process.env.SANDBOX_CPU_MILLIS || 500),
      memory_mb: Number(process.env.SANDBOX_MEMORY_MB || 2048),
      ttl_seconds: Number(process.env.SANDBOX_TTL_SEC || 900),
      last_reap: null,
    };
    return res.json({ ok: true, pool: defaultPool });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('GET /admin/sandbox/pool error:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: { message: 'Failed to fetch pool', details: String(err) } });
  }
});

/* GET /admin/sandbox/sessions */
router.get('/admin/sandbox/sessions', async (req: Request, res: Response) => {
  if (!isOperatorAuthorized(req)) {
    return res.status(403).json({ ok: false, error: { message: 'Operator authorization required' } });
  }

  try {
    const runner = tryRequireSandboxRunner();
    if (runner && typeof runner.listActiveSessions === 'function') {
      const sessions = await runner.listActiveSessions();
      return res.json({ ok: true, sessions });
    }

    // Dev fallback: return empty array or a small synthetic session
    const demoSession = {
      session_id: 'demo-session-1',
      sku_id: 'sku-demo-1',
      endpoint: 'wss://preview.local/demo-session-1',
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: 'running',
      actor_id: 'actor:demo',
      metadata: {},
    };
    return res.json({ ok: true, sessions: [demoSession] });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('GET /admin/sandbox/sessions error:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: { message: 'Failed to list sessions', details: String(err) } });
  }
});

/* POST /admin/sandbox/reap */
router.post('/admin/sandbox/reap', async (req: Request, res: Response) => {
  if (!isOperatorAuthorized(req)) {
    return res.status(403).json({ ok: false, error: { message: 'Operator authorization required' } });
  }

  try {
    const runner = tryRequireSandboxRunner();
    if (runner && typeof runner.reapPool === 'function') {
      const result = await runner.reapPool();
      return res.json({ ok: true, result });
    }

    // Dev fallback: pretend we reaped one expired session
    const result = { reaped: 0, message: 'No real sandboxRunner available; this is a dev stub.' };
    return res.json({ ok: true, result });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('POST /admin/sandbox/reap error:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: { message: 'Failed to reap pool', details: String(err) } });
  }
});

/* POST /admin/sandbox/sessions/:id/stop */
router.post('/admin/sandbox/sessions/:id/stop', async (req: Request, res: Response) => {
  if (!isOperatorAuthorized(req)) {
    return res.status(403).json({ ok: false, error: { message: 'Operator authorization required' } });
  }

  const sessionId = String(req.params.id || '').trim();
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: { message: 'session id required' } });
  }

  try {
    const runner = tryRequireSandboxRunner();
    if (runner && typeof runner.stopSession === 'function') {
      const result = await runner.stopSession(sessionId);
      return res.json({ ok: true, stopped: Boolean(result) });
    }

    // Dev fallback: indicate stopped true
    return res.json({ ok: true, stopped: true, message: 'Dev stubbed stop' });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('POST /admin/sandbox/sessions/:id/stop error:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: { message: 'Failed to stop session', details: String(err) } });
  }
});

export default router;

