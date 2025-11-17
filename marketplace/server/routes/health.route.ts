import { Router, Request, Response } from 'express';

const router = Router();

/**
 * GET /health
 * Minimal health indicating mTLS/kernel/signing presence (best-effort).
 */
router.get('/health', (_req: Request, res: Response) => {
  const requireKms = String(process.env.REQUIRE_KMS || 'false') === 'true';
  const requireSigningProxy = String(process.env.REQUIRE_SIGNING_PROXY || 'false') === 'true';
  const signingConfigured = Boolean(process.env.SIGNING_PROXY_URL || process.env.AUDIT_SIGNING_KMS_KEY_ID) || requireKms || requireSigningProxy;

  const kernelConfigured = Boolean(process.env.KERNEL_API_URL);
  const mTLSConfigured = Boolean(process.env.KERNEL_CLIENT_CERT && process.env.KERNEL_CLIENT_KEY);

  return res.json({
    ok: true,
    mTLS: mTLSConfigured,
    kernelConfigured,
    signingConfigured,
  });
});

/**
 * GET /ready
 * Readiness probe for SRE. Should be upgraded to probe DB, S3 and Kernel in production.
 */
router.get('/ready', (_req: Request, res: Response) => {
  const db = Boolean(process.env.DATABASE_URL);
  const s3 = Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET);
  const kernel = Boolean(process.env.KERNEL_API_URL);

  if (db && s3) {
    return res.json({ ok: true, db: true, s3: true, kernel });
  }

  return res.status(500).json({
    ok: false,
    error: { code: 'NOT_READY', message: 'Missing runtime dependencies', details: { db: !!db, s3: !!s3, kernel } },
  });
});

export default router;

