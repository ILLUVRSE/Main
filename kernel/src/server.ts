/**
 * kernel/src/server.ts
 *
 * Production-minded Kernel HTTP server entrypoint.
 *
 * Notes:
 * - Exposes createApp() and start() used by tests and runtime.
 * - Avoids top-level await. All async work is inside async functions.
 * - Provides minimal /ready and /metrics endpoints for test readiness.
 */

import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import createKernelRouter from './routes/kernelRoutes';
import { waitForDb, runMigrations } from './db';
import {
  observeHttpRequest,
  incrementServerStart,
  incrementReadinessSuccess,
  incrementReadinessFailure,
  incrementKmsProbeSuccess,
  incrementKmsProbeFailure,
  getMetrics,
  getMetricsContentType,
} from './metrics/prometheus';

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const REQUIRE_KMS = (process.env.REQUIRE_KMS || 'false').toLowerCase() === 'true';
const KMS_ENDPOINT = (process.env.KMS_ENDPOINT || '').replace(/\/$/, '');
const OPENAPI_PATH = process.env.OPENAPI_PATH
  ? path.resolve(process.cwd(), process.env.OPENAPI_PATH)
  : path.resolve(__dirname, '../openapi.yaml');
const IS_PRODUCTION = NODE_ENV === 'production';

const LOG_PREFIX = '[kernel:' + NODE_ENV + ']';

/** Logging helpers */
function info(...args: any[]) { console.info(LOG_PREFIX, ...args); }
function warn(...args: any[]) { console.warn(LOG_PREFIX, ...args); }
function error(...args: any[]) { console.error(LOG_PREFIX, ...args); }
function debug(...args: any[]) { if ((process.env.LOG_LEVEL || '').toLowerCase() === 'debug') console.debug(LOG_PREFIX, ...args); }

/** Probe KMS reachability (best-effort) */
async function checkKmsReachable(timeoutMs = 3000): Promise<boolean> {
  if (!KMS_ENDPOINT) return false;
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    // @ts-ignore global fetch exists in Node 18+ in many environments
    const res = await (globalThis as any).fetch(KMS_ENDPOINT, { method: 'GET', signal: controller.signal });
    clearTimeout(id);
    return true;
  } catch (err) {
    return false;
  }
}

/** Readiness checks: DB and KMS (if required) */
async function readinessCheck(): Promise<{ ok: boolean; details?: string }> {
  // DB quick check
  try {
    await waitForDb(5_000, 500);
  } catch (e) {
    incrementReadinessFailure();
    return { ok: false, details: 'db.unreachable' };
  }

  // KMS check when required/configured
  if (REQUIRE_KMS || KMS_ENDPOINT) {
    const reachable = await checkKmsReachable(3000);
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

export const __testables = {
  readinessCheck,
  checkKmsReachable,
  OPENAPI_PATH,
  NODE_ENV,
  REQUIRE_KMS,
  KMS_ENDPOINT,
};

/** Try to install OpenAPI validator if available (best-effort) */
async function tryInstallOpenApiValidator(app: express.Express, apiSpec: any): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const OpenApiValidatorModule: any = require('express-openapi-validator');
    const middlewareFactory =
      OpenApiValidatorModule?.middleware ||
      OpenApiValidatorModule?.default?.middleware;

    const validatorOptions = {
      apiSpec,
      validateRequests: true,
      validateResponses: false,
      ignoreUndocumented: true, // allow test-only/dev routes outside the published spec
    };

    if (typeof middlewareFactory === 'function') {
      app.use(middlewareFactory(validatorOptions));
      info('OpenAPI validation enabled using ' + OPENAPI_PATH);
      return true;
    }

    const ValidatorCtor: any =
      OpenApiValidatorModule?.OpenApiValidator ||
      OpenApiValidatorModule?.default?.OpenApiValidator ||
      OpenApiValidatorModule?.default ||
      OpenApiValidatorModule;

    if (ValidatorCtor && typeof ValidatorCtor === 'function') {
      const instance: any = new ValidatorCtor(validatorOptions);
      if (typeof instance.install === 'function') {
        await instance.install(app);
        info('OpenAPI validation enabled using ' + OPENAPI_PATH);
        return true;
      }
    }

    throw new Error('express-openapi-validator export shape not recognized');
  } catch (err) {
    warn('Failed to load/install OpenAPI validator:', (err as Error).message || err);
    return false;
  }
}

/**
 * createApp
 * Builds and returns an Express app instance.
 */
export async function createApp() {
  const app = express();
  app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));
  app.use((req, res, next) => {
    res.locals.routePath = req.path;
    const start = process.hrtime.bigint();
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
      const routeLabel =
        (res.locals.routePath as string) || (req.route && req.route.path) || req.path || req.originalUrl || 'unknown';
      observeHttpRequest({
        method: req.method,
        route: routeLabel,
        statusCode: res.statusCode || 0,
        durationSeconds: durationSeconds < 0 ? 0 : durationSeconds,
      });
    };
    res.once('finish', record);
    res.once('close', record);
    next();
  });

  // simple request logging
  app.use((req, _res, next) => {
    debug(req.method + ' ' + req.path);
    next();
  });

  // Load OpenAPI if present and try to install validator
  if (fs.existsSync(OPENAPI_PATH)) {
    try {
      const raw = fs.readFileSync(OPENAPI_PATH, 'utf8');
      const apiSpec = yaml.load(raw) as object;
      if (!apiSpec) {
        throw new Error('OpenAPI spec parsed to empty result');
      }
      const installed = await tryInstallOpenApiValidator(app, apiSpec);
      if (!installed && IS_PRODUCTION) {
        throw new Error('OpenAPI validator failed to initialize in production. Ensure express-openapi-validator is installed.');
      }
    } catch (err) {
      const message = 'OpenAPI load failed: ' + ((err as Error).message || err);
      if (IS_PRODUCTION) {
        error(message);
        throw new Error(message);
      }
      warn(message);
    }
  } else {
    const message = 'OpenAPI not found at ' + OPENAPI_PATH + ' - request validation disabled.';
    if (IS_PRODUCTION) {
      error(message);
      throw new Error(message);
    }
    warn(message);
  }

  // Mount kernel router
  app.use('/', createKernelRouter());

  // Liveness endpoint
  app.get('/health', (_req: Request, res: Response) => {
    return res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // Readiness endpoint
  app.get('/ready', async (_req: Request, res: Response) => {
    const r = await readinessCheck();
    if (!r.ok) return res.status(503).json({ status: 'not_ready', details: r.details ?? null });
    return res.json({ status: 'ready' });
  });

  // Metrics endpoint
  app.get('/metrics', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', getMetricsContentType());
    res.send(getMetrics());
  });

  // Generic error handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    error('Unhandled error:', err && err.stack ? err.stack : err);
    if (err?.status && err?.errors) {
      return res.status(err.status).json({ error: 'validation_error', details: err.errors });
    }
    return res.status(err?.status || 500).json({ error: err?.message || 'internal_error' });
  });

  return app;
}

/**
 * start
 * - Waits for DB, runs migrations, then starts HTTP server.
 * - Performs KMS enforcement when NODE_ENV=production && REQUIRE_KMS=true (fail-fast).
 */
async function start() {
  try {
    info('Kernel server starting...');
    info('NODE_ENV=' + NODE_ENV + ' REQUIRE_KMS=' + REQUIRE_KMS + ' KMS_ENDPOINT=' + (KMS_ENDPOINT ? 'configured' : 'unset'));
    incrementServerStart();

    if (NODE_ENV === 'production' && REQUIRE_KMS) {
      if (!KMS_ENDPOINT) {
        error('Fatal: REQUIRE_KMS=true and KMS_ENDPOINT is not set. Exiting.');
        process.exit(1);
      }
      info('Probing KMS endpoint for reachability...');
      const ok = await checkKmsReachable(3_000);
      if (!ok) {
        error('Fatal: REQUIRE_KMS=true but KMS_ENDPOINT is unreachable. Exiting.');
        incrementKmsProbeFailure();
        process.exit(1);
      }
      info('KMS probe succeeded.');
      incrementKmsProbeSuccess();
    }

    // Wait for DB and run migrations
    info('Waiting for Postgres...');
    await waitForDb(30_000, 500);

    try {
      info('Applying migrations...');
      await runMigrations();
      info('Migrations applied.');
    } catch (err) {
      warn('Migration runner failed (continuing):', (err as Error).message || err);
    }

    // Create and start app
    const app = await createApp();
    const server = app.listen(PORT, () => {
      incrementServerStart();
      info('Kernel server listening on port ' + PORT);
      // Perform initial readiness check in background
      readinessCheck().then((r) => {
        if (!r.ok) {
          warn('Initial readiness check failed:', r.details);
        } else {
          info('Initial readiness check succeeded');
        }
      }).catch((e) => {
        warn('Initial readiness check error:', (e as Error).message || e);
      });
    });

    // Graceful shutdown
    const shutdown = async () => {
      info('Shutting down Kernel server...');
      server.close(() => {
        info('HTTP server closed.');
        process.exit(0);
      });
      setTimeout(() => {
        warn('Forcing shutdown.');
        process.exit(1);
      }, 10_000).unref();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    error('Fatal error starting Kernel server:', (err as Error).message || err);
    process.exit(1);
  }
}

/** If invoked directly, start the server. */
if (require.main === module) {
  start();
}
