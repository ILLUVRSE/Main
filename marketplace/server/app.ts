import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { getMetricsRegistry } from './lib/metrics';
import { enforceStartupGuards } from '../../infra/startupGuards';

dotenv.config();
enforceStartupGuards({ serviceName: 'marketplace-api' });

const app = express();

// Extend Express Request to carry a small context object
declare global {
  namespace Express {
    interface Request {
      context?: {
        requestId: string;
        actorId?: string;
        idempotencyKey?: string;
      };
    }
  }
}

/**
 * Basic middleware
 */
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/**
 * Request ID middleware
 */
app.use((req: Request, _res: Response, next: NextFunction) => {
  const requestId: string = req.header('X-Request-Id') ?? uuidv4();
  if (!req.context) {
    req.context = { requestId };
  } else {
    req.context.requestId = req.context.requestId || requestId;
  }
  resSetHeaderSafe(_res, 'X-Request-Id', req.context.requestId);
  next();
});

/**
 * Idempotency-key middleware (records header on request.context)
 * NOTE: Proper idempotency storage should be backed by DB or redis.
 */
app.use((req: Request, _res: Response, next: NextFunction) => {
  const idempotencyKey = req.header('Idempotency-Key') || undefined;
  req.context = req.context || { requestId: uuidv4() };
  req.context.idempotencyKey = idempotencyKey;
  next();
});

/**
 * Lightweight auth placeholder
 * - For buyer-facing calls, controllers should validate JWT/OIDC.
 * - This middleware extracts a Bearer token and sets actorId for audit purposes.
 */
app.use((req: Request, _res: Response, next: NextFunction) => {
  const auth = req.header('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    // In dev mode we do not validate tokens here. Real validation should occur in route handlers.
    // For audit/trace we attach a best-effort actor id.
    req.context = req.context || { requestId: uuidv4() };
    req.context.actorId = `actor:${token.substring(0, 16)}`;
  }
  next();
});

/**
 * Simple health endpoints (run-local.sh and CI check /health and /ready)
 *
 * These return a minimal JSON envelope compatible with marketplace/api.md.
 * Implementations can be made richer later (mTLS/kms checks).
 */
app.get('/health', (_req: Request, res: Response) => {
  const health = computeSigningAndInfraState();
  return res.json({
    ok: health.ok,
    mTLS: health.mtlsConfigured,
    kernelConfigured: health.kernelConfigured,
    signingConfigured: health.signingConfigured,
    details: health.details,
  });
});

app.get('/ready', async (_req: Request, res: Response) => {
  const db = Boolean(process.env.DATABASE_URL);
  const s3 = Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET);
  const kernel = Boolean(process.env.KERNEL_API_URL);
  const signing = computeSigningAndInfraState();

  if (db && s3 && signing.ok) {
    return res.json({ ok: true, db: true, s3: true, kernel, signing: signing.details });
  }
  return res.status(500).json({
    ok: false,
    error: {
      code: 'NOT_READY',
      message: 'Missing runtime dependencies',
      details: { db, s3, kernel, signing: signing.details },
    },
  });
});

function computeSigningAndInfraState() {
  const requireKms = toBool(process.env.REQUIRE_KMS);
  const requireSigningProxy = toBool(process.env.REQUIRE_SIGNING_PROXY);
  const signingProxyConfigured = Boolean(process.env.SIGNING_PROXY_URL);
  const kmsConfigured = Boolean(
    process.env.AUDIT_SIGNING_KMS_KEY_ID ||
      process.env.AUDIT_SIGNING_KMS_KEY ||
      process.env.AWS_KMS_KEY_ID ||
      process.env.KMS_KEY_ID ||
      process.env.MARKETPLACE_KMS_KEY_ID
  );
  const kernelConfigured = Boolean(process.env.KERNEL_API_URL);
  const mtlsConfigured = Boolean(process.env.MTLS_CA_CERT || process.env.MTLS_CA_BUNDLE || (process.env.KERNEL_CLIENT_CERT && process.env.KERNEL_CLIENT_KEY));

  const signingErrors: string[] = [];
  if (requireKms && !kmsConfigured) signingErrors.push('REQUIRE_KMS=true but no *_KMS_KEY_ID env configured');
  if (requireSigningProxy && !signingProxyConfigured) signingErrors.push('REQUIRE_SIGNING_PROXY=true but SIGNING_PROXY_URL missing');
  const signingConfigured = kmsConfigured || signingProxyConfigured;

  return {
    ok: signingErrors.length === 0,
    kernelConfigured,
    mtlsConfigured,
    signingConfigured,
    details: {
      kmsConfigured,
      signingProxyConfigured,
      requireKms,
      requireSigningProxy,
      signingErrors,
    },
  };
}

function toBool(value?: string) {
  return String(value || '').toLowerCase() === 'true';
}

const metricsRegistry = getMetricsRegistry();
app.get('/metrics', async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
});

/**
 * Mount service routers (these files will be created in subsequent steps)
 * Example: app.use('/', checkoutRouter) expects routes at /checkout etc.
 *
 * Keep these guarded with try/catch so the app can still start if route files
 * are not yet implemented during early scaffolding.
 */
function tryMount(path: string, importPath: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const router = require(importPath);
    if (router && router.default) {
      app.use(path, router.default);
    } else if (router) {
      app.use(path, router);
    }
  } catch (err) {
    // route not present yet — log and continue (useful during incremental file creation)
    // console.debug left intentionally minimal so devs notice missing routes but app still starts.
    // Replace with proper logging as the service matures.
    // eslint-disable-next-line no-console
    console.debug(`Router ${importPath} not mounted (file may not exist yet):`, (err as Error).message);
  }
}

/* Mount expected route modules (they will be created next) */
tryMount('/', './routes/checkout.route');
tryMount('/', './routes/order.route');
tryMount('/', './routes/proofs.route');
tryMount('/', './routes/license.route');
tryMount('/', './routes/preview.route');
tryMount('/', './routes/sku.route');
tryMount('/', './routes/catalog.route');
tryMount('/admin', './routes/admin.route');
// You can add more mount points later (metrics, debug, etc.)

/**
 * Error handler — JSON envelope `{ ok: false, error: { code, message, details } }`
 */
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error('Unhandled error in request handling:', err && err.stack ? err.stack : err);
  const code = err?.code || 'INTERNAL_ERROR';
  const message = err?.message || 'Internal server error';
  const details = err?.details || undefined;
  res.status(err?.status || 500).json({ ok: false, error: { code, message, details } });
});

/**
 * Helper to avoid TypeScript type issues when setting headers on Response inside middleware
 */
function resSetHeaderSafe(res: Response, name: string, value: string) {
  try {
    res.setHeader(name, value);
  } catch {
    // ignore
  }
}

export default app;

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[marketplace] listening on http://0.0.0.0:${port}`);
  });
}
