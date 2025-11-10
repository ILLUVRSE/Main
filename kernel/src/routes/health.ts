/**
 * kernel/src/routes/health.ts
 *
 * Centralised health/readiness helpers shared by both the top-level Express
 * server and the kernel routes module. Having a dedicated module keeps the
 * response contract consistent across entrypoints and makes it easier to test
 * failure scenarios by mocking the exported probe functions.
 */

import { Router, Request, Response } from 'express';
import { waitForDb } from '../db';
import {
  incrementKmsProbeFailure,
  incrementKmsProbeSuccess,
  incrementReadinessFailure,
  incrementReadinessSuccess,
} from '../metrics/prometheus';
import { loadKmsConfig } from '../config/kms';
import { probeKmsReachable } from '../services/kms';

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
  db_reachable: boolean;
  kms_reachable: boolean;
  signer_id: string;
  app_version: string;
  slo: SloMetadata;
}

export interface SloMetadata {
  availability_target: string;
  latency_p99_ms: number;
  rto_seconds: number;
}

const DEFAULT_SLO: SloMetadata = {
  availability_target: process.env.SLO_AVAILABILITY_TARGET || '99.9%',
  latency_p99_ms: Number(process.env.SLO_LATENCY_P99_MS || 500),
  rto_seconds: Number(process.env.SLO_RTO_SECONDS || 60),
};

/**
 * probeDatabase attempts to query the database using waitForDb.
 * It resolves to true when the DB responds within the timeout window.
 */
export async function probeDatabase(timeoutMs = 1_000): Promise<boolean> {
  try {
    await waitForDb(timeoutMs, Math.max(100, Math.floor(timeoutMs / 5)));
    return true;
  } catch {
    return false;
  }
}

/**
 * probeKms uses the shared KMS configuration to determine reachability.
 */
export async function probeKms(timeoutMs = 3_000): Promise<boolean> {
  const { endpoint } = loadKmsConfig();
  if (!endpoint) {
    return false;
  }
  return probeKmsReachable(endpoint, timeoutMs);
}

export function resolveSloMetadata(): SloMetadata {
  return {
    availability_target: process.env.SLO_AVAILABILITY_TARGET || DEFAULT_SLO.availability_target,
    latency_p99_ms: Number(process.env.SLO_LATENCY_P99_MS || DEFAULT_SLO.latency_p99_ms),
    rto_seconds: Number(process.env.SLO_RTO_SECONDS || DEFAULT_SLO.rto_seconds),
  };
}

export async function buildHealthResponse(): Promise<HealthResponse> {
  // Import the module at runtime so jest.spyOn on exported functions affects these calls.
  const m = await import('./health') as typeof import('./health');
  const [dbReachable, kmsReachable] = await Promise.all([m.probeDatabase(), m.probeKms()]);
  const { signerId } = loadKmsConfig();

  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    db_reachable: dbReachable,
    kms_reachable: kmsReachable,
    signer_id: signerId,
    app_version: process.env.APP_VERSION || 'dev',
    slo: resolveSloMetadata(),
  };
}

export interface ReadinessResult {
  ok: boolean;
  details?: string;
}

export async function readinessCheck(): Promise<ReadinessResult> {
  const { requireKms, endpoint } = loadKmsConfig();

  // Call the probe via the module namespace so tests that spy on the exported functions work.
  const m = await import('./health') as typeof import('./health');

  const dbReachable = await m.probeDatabase(5_000);
  if (!dbReachable) {
    incrementReadinessFailure();
    return { ok: false, details: 'db.unreachable' };
  }

  if (requireKms || endpoint) {
    const reachable = await probeKms(3_000);
    if (!reachable) {
      incrementKmsProbeFailure();
      incrementReadinessFailure();
      return { ok: false, details: 'kms.unreachable' };
    }
    incrementKmsProbeSuccess();
  }

  incrementReadinessSuccess();
  return { ok: true };
}

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/health', async (_req: Request, res: Response) => {
    const payload = await buildHealthResponse();
    return res.json(payload);
  });

  router.get('/ready', async (_req: Request, res: Response) => {
    const result = await readinessCheck();
    if (!result.ok) {
      return res.status(503).json({ status: 'not_ready', details: result.details ?? null });
    }
    return res.json({ status: 'ready' });
  });

  return router;
}

export default createHealthRouter;

