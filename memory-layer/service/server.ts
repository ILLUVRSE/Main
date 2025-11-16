import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import memoryRoutes from './routes/memoryRoutes';
import { VectorDbAdapter } from './vector/vectorDbAdapter';
import { createMemoryService } from './services/memoryService';
import { getPool } from './db';
import { authMiddleware } from './middleware/auth';

/**
 * Startup guard: in production or when REQUIRE_KMS=true we require that an audit signing
 * capability is configured. Previously this checked AUDIT_KMS_KEY_ID / KMS_ENDPOINT; align
 * checks with auditChain expectations:
 *
 * Required when (NODE_ENV=production) OR (REQUIRE_KMS=true):
 *   - AUDIT_SIGNING_KMS_KEY_ID   (preferred) OR
 *   - SIGNING_PROXY_URL          (remote signing proxy) OR
 *   - AUDIT_SIGNING_KEY / AUDIT_SIGNING_SECRET / AUDIT_SIGNING_PRIVATE_KEY (local key fallback)
 *
 * This check is intentionally conservative: if none of the above are present we fail startup
 * with actionable error text to avoid producing unsigned audit events in prod.
 */

const nodeEnv = process.env.NODE_ENV ?? 'development';
const requireKms = String(process.env.REQUIRE_KMS ?? '').toLowerCase() === 'true';

if (nodeEnv === 'production' && String(process.env.DEV_SKIP_MTLS ?? '').toLowerCase() === 'true') {
  console.error('[startup] DEV_SKIP_MTLS=true is forbidden in production');
  process.exit(1);
}

if (nodeEnv === 'production' || requireKms) {
  const hasKmsKey = Boolean(process.env.AUDIT_SIGNING_KMS_KEY_ID || process.env.AUDIT_SIGNING_KMS_KEY);
  const hasSigningProxy = Boolean(process.env.SIGNING_PROXY_URL);
  const hasLocalKey =
    Boolean(process.env.AUDIT_SIGNING_KEY) ||
    Boolean(process.env.AUDIT_SIGNING_SECRET) ||
    Boolean(process.env.AUDIT_SIGNING_PRIVATE_KEY);

  if (!hasKmsKey && !hasSigningProxy && !hasLocalKey) {
    console.error(
      '[startup] Audit signing is required in this environment but no signer is configured.\n' +
        'Set one of: AUDIT_SIGNING_KMS_KEY_ID (preferred), SIGNING_PROXY_URL, or a local key via AUDIT_SIGNING_KEY / AUDIT_SIGNING_SECRET / AUDIT_SIGNING_PRIVATE_KEY.\n' +
        'If using AWS KMS ensure AUDIT_SIGNING_KMS_KEY_ID points to a valid KMS key ARN and AWS credentials + region are available.'
    );
    process.exit(1);
  }
}

const app = express();
app.use(express.json({ limit: '2mb' }));

const vectorAdapter = new VectorDbAdapter({
  provider: process.env.VECTOR_DB_PROVIDER,
  endpoint: process.env.VECTOR_DB_ENDPOINT,
  apiKey: process.env.VECTOR_DB_API_KEY,
  namespace: process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory',
  pool: getPool()
});

const memoryService = createMemoryService({ vectorAdapter });

app.get('/healthz', async (_req: Request, res: Response) => {
  try {
    await getPool().query('SELECT 1');
    const vectorStatus = await vectorAdapter.healthCheck();
    res.json({
      status: 'ok',
      vector: vectorStatus
    });
  } catch (err) {
    console.error('[healthz] failed', err);
    res.status(500).json({ status: 'error', message: (err as Error).message });
  }
});

app.get('/readyz', async (_req: Request, res: Response) => {
  try {
    const vectorStatus = await vectorAdapter.healthCheck();
    res.json({
      status: 'ready',
      vector: vectorStatus
    });
  } catch (err) {
    res.status(503).json({ status: 'degraded', message: (err as Error).message });
  }
});

app.use('/v1', authMiddleware, memoryRoutes(memoryService));

// Simple error handler so the scaffold surfaces JSON errors.
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[memory-layer] request failed', err);
  res.status(err.status ?? 500).json({
    error: {
      message: err.message
    }
  });
});

const port = Number(process.env.PORT ?? 4300);

if (require.main === module) {
  app.listen(port, () => {
    console.info(`Memory Layer service listening on port ${port}`);
  });
}

export default app;

