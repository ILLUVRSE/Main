// sentinelnet/src/health/health.ts
import { Router, Request, Response } from 'express';
import logger from '../logger';
import db from '../db';
import { loadConfig } from '../config/env';
import axios from 'axios';

const config = loadConfig();
const router = Router();

/**
 * Lightweight health endpoint.
 * Returns basic info about the service.
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'sentinelnet',
    env: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Readiness check.
 * - If DB configured: run a trivial query.
 * - If KERNEL_AUDIT_URL configured: attempt a HEAD/GET to its /health if available (best-effort).
 * If neither is configured (local dev), return ready.
 */
router.get('/ready', async (_req: Request, res: Response) => {
  const checks: Record<string, any> = { ok: true };

  // DB check
  if (config.dbUrl) {
    try {
      await db.query('SELECT 1');
      checks.db = { ok: true };
    } catch (err) {
      logger.warn('health: db readiness failed', err);
      checks.db = { ok: false, error: (err as Error).message || err };
      checks.ok = false;
    }
  } else {
    checks.db = { ok: false, note: 'SENTINEL_DB_URL not configured (dev mode)' };
  }

  // Kernel health probe (best-effort)
  const kernelBase = config.kernelAuditUrl || process.env.KERNEL_AUDIT_URL || '';
  if (kernelBase) {
    try {
      const url = `${kernelBase.replace(/\/$/, '')}/health`;
      const resp = await axios.get(url, { timeout: 3000 }).catch(() => null);
      if (resp && resp.status === 200 && resp.data?.ok) {
        checks.kernel = { ok: true };
      } else {
        checks.kernel = { ok: false, error: 'kernel health endpoint unreachable or unhealthy' };
        checks.ok = false;
      }
    } catch (err) {
      logger.warn('health: kernel probe failed', err);
      checks.kernel = { ok: false, error: (err as Error).message || err };
      checks.ok = false;
    }
  } else {
    checks.kernel = { ok: false, note: 'KERNEL_AUDIT_URL not configured (optional)' };
  }

  if (checks.ok) {
    return res.json({ ok: true, checks });
  }
  return res.status(503).json({ ok: false, checks });
});

export default router;

