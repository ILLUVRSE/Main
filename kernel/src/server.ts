/**
 * kernel/src/server.ts
 *
 * Production-minded Kernel HTTP server entrypoint.
 *
 * Notes:
 * - Exports `checkKmsReachable` for tests.
 * - Uses Node http/https for KMS probing (no global fetch dependency).
 * - Exposes guarded test endpoints when ENABLE_TEST_ENDPOINTS=true or NODE_ENV=test.
 */
import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import yaml from 'js-yaml';
import createKernelRouter from './routes/kernelRoutes';
import createAdminRouter from './routes/adminRoutes';
import { waitForDb, runMigrations } from './db';
import { initOidc } from './auth/oidc';
import { authMiddleware } from './auth/middleware';
import { getPrincipalFromRequest, requireRoles, requireAnyAuthenticated, Roles } from './rbac';
import { createOpenApiValidator } from './middleware/openapiValidator';
import { metricsMiddleware } from './middleware/metrics';
import {
  getMetrics,
  getMetricsContentType,
  incrementKmsProbeFailure,
  incrementKmsProbeSuccess,
  incrementReadinessFailure,
  incrementReadinessSuccess,
  incrementServerStart,
} from './metrics/prometheus';

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const REQUIRE_KMS = (process.env.REQUIRE_KMS || 'false').toLowerCase() === 'true';
const KMS_ENDPOINT = (process.env.KMS_ENDPOINT || '').replace(/\/$/, '');
const OPENAPI_PATH = process.env.OPENAPI_PATH
  ? path.resolve(process.cwd(), process.env.OPENAPI_PATH)
  : path.resolve(__dirname, '../openapi.yaml');

const MTLS_CERT = process.env.MTLS_CERT || '';
const MTLS_KEY = process.env.MTLS_KEY || '';
const MTLS_CLIENT_CA = process.env.MTLS_CLIENT_CA || '';
const MTLS_REQUIRE_CLIENT_CERT = (process.env.MTLS_REQUIRE_CLIENT_CERT || 'false').toLowerCase() === 'true';

const ENABLE_TEST_ENDPOINTS =
  (process.env.ENABLE_TEST_ENDPOINTS || '').toLowerCase() === 'true' || NODE_ENV === 'test';

const LOG_PREFIX = '[kernel:' + NODE_ENV + ']';
function info(...args: any[]) { console.info(LOG_PREFIX, ...args); }
function warn(...args: any[]) { console.warn(LOG_PREFIX, ...args); }
function error(...args: any[]) { console.error(LOG_PREFIX, ...args); }
function debug(...args: any[]) { if ((process.env.LOG_LEVEL || '').toLowerCase() === 'debug') console.debug(LOG_PREFIX, ...args); }

/**
 * checkKmsReachable
 */
export async function checkKmsReachable(timeoutMs = 3000): Promise<boolean> {
  if (!KMS_ENDPOINT) return false;

  try {
    const u = new URL(KMS_ENDPOINT);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;

    return await new Promise<boolean>((resolve) => {
      const opts: any = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: (u.pathname || '/') + (u.search || ''),
        method: 'GET',
        timeout: timeoutMs,
      };

      const req = lib.request(opts, (res: any) => {
        res.on('data', () => {});
        res.on('end', () => {});
        resolve(true);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        try { req.destroy(); } catch {}
        resolve(false);
      });

      req.end();
    });
  } catch {
    return false;
  }
}

/**
 * readinessCheck
 */
async function readinessCheck(): Promise<{ ok: boolean; details?: string }> {
  try {
    try {
      await waitForDb(5_000, 500);
    } catch (e) {
      incrementReadinessFailure();
      return { ok: false, details: 'db.unreachable' };
    }

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
  } catch (err) {
    incrementReadinessFailure();
    return { ok: false, details: (err as Error).message || 'unknown' };
  }
}

/**
 * createApp
 */
export async function createApp() {
  const app = express();
  app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));
  app.use(metricsMiddleware);

  try {
    app.use((req: Request, res: Response, next: NextFunction) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      Promise.resolve(authMiddleware(req as any, res as any, next)).catch(next);
    });
  } catch (e) {
    warn('Failed to install auth middleware:', (e as Error).message || e);
  }

  app.use((req, _res, next) => { debug(req.method + ' ' + req.path); next(); });

  if (fs.existsSync(OPENAPI_PATH)) {
    try {
      const raw = fs.readFileSync(OPENAPI_PATH, 'utf8');
      const apiSpec = yaml.load(raw) as object;
      const validator = await createOpenApiValidator(apiSpec);
      app.use(validator);
      info('OpenAPI validation enabled using ' + OPENAPI_PATH);
    } catch (err) {
      warn('OpenAPI load failed:', (err as Error).message || err);
    }
  } else {
    warn('OpenAPI not found at ' + OPENAPI_PATH + ' - request validation disabled.');
  }

  app.use('/', createKernelRouter());
  app.use('/', createAdminRouter());

  if (ENABLE_TEST_ENDPOINTS) {
    info('ENABLE_TEST_ENDPOINTS=true -> installing test-only endpoints: /principal /require-any /require-roles');

    app.get('/principal', (req: Request, res: Response) => {
      const principal = (req as any).principal ?? getPrincipalFromRequest(req as any);
      (req as any).principal = principal;
      return res.json({ principal } as any);
    });

    app.get('/require-any', requireAnyAuthenticated, (req: Request, res: Response) => {
      return res.json({ ok: true, principal: (req as any).principal } as any);
    });

    app.get(
      '/require-roles',
      requireRoles(Roles.SUPERADMIN, Roles.OPERATOR),
      (req: Request, res: Response) => {
        return res.json({ ok: true, principal: (req as any).principal } as any);
      }
    );
  }

  app.get('/health', (_req: Request, res: Response) => {
    return res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  app.get('/ready', async (_req: Request, res: Response) => {
    const r = await readinessCheck();
    if (!r.ok) return res.status(503).json({ status: 'not_ready', details: r.details ?? null });
    return res.json({ status: 'ready' });
  });

  app.get('/metrics', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', getMetricsContentType());
    res.send(getMetrics());
  });

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
 */
async function start() {
  try {
    info('Kernel server starting...');
    info('NODE_ENV=' + NODE_ENV + ' REQUIRE_KMS=' + REQUIRE_KMS + ' KMS_ENDPOINT=' + (KMS_ENDPOINT ? 'configured' : 'unset'));

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

    if (process.env.OIDC_ISSUER) {
      try {
        info('Initializing OIDC client...');
        await initOidc();
        info('OIDC initialized.');
      } catch (e) {
        warn('OIDC initialization failed (continuing):', (e as Error).message || e);
      }
    } else {
      debug('OIDC not configured, skipping OIDC init');
    }

    if (NODE_ENV !== 'development') {
      info('Waiting for Postgres...');
      await waitForDb(30_000, 500);

      try {
        info('Applying migrations...');
        await runMigrations();
        info('Migrations applied.');
      } catch (err) {
        warn('Migration runner failed (continuing):', (err as Error).message || err);
      }
    } else {
      warn('NODE_ENV=development — skipping DB wait and migrations for local dev');
    }

    const app = await createApp();

    if (MTLS_CERT && MTLS_KEY) {
      const shouldRequireClientCert = MTLS_REQUIRE_CLIENT_CERT || NODE_ENV === 'production';
      info(
        'Starting HTTPS server (mTLS config present). requestCert=' + shouldRequireClientCert +
          ' NODE_ENV=' + NODE_ENV,
      );
      try {
        const tlsOptions: https.ServerOptions = {
          key: fs.readFileSync(MTLS_KEY),
          cert: fs.readFileSync(MTLS_CERT),
          requestCert: shouldRequireClientCert,
          rejectUnauthorized: shouldRequireClientCert,
        };
        if (MTLS_CLIENT_CA) {
          try {
            tlsOptions.ca = fs.readFileSync(MTLS_CLIENT_CA);
          } catch (e) {
            warn('Failed to read MTLS_CLIENT_CA:', (e as Error).message || e);
          }
        } else if (shouldRequireClientCert) {
          warn('Client certificate required but MTLS_CLIENT_CA is not configured. Using default trust store.');
        }
        const server = https.createServer(tlsOptions, app).listen(PORT, () => {
          incrementServerStart();
          info('Kernel HTTPS server listening on port ' + PORT);
          readinessCheck().then((r) => {
            if (!r.ok) warn('Initial readiness check failed:', r.details);
            else info('Initial readiness check succeeded');
          }).catch((e) => warn('Initial readiness_check error:', (e as Error).message || e));
        });
        const shutdown = async () => {
          info('Shutting down Kernel HTTPS server...');
          server.close(() => {
            info('HTTPS server closed.');
            process.exit(0);
          });
          setTimeout(() => {
            warn('Forcing shutdown.');
            process.exit(1);
          }, 10_000).unref();
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        return;
      } catch (e) {
        error('Failed to start HTTPS server:', (e as Error).message || e);
        process.exit(1);
      }
    }

    const server = app.listen(PORT, () => {
      incrementServerStart();
      info('Kernel server listening on port ' + PORT);
      readinessCheck().then((r) => {
        if (!r.ok) warn('Initial readiness check failed:', r.details);
        else info('Initial readiness check succeeded');
      }).catch((e) => warn('Initial readiness_check error:', (e as Error).message || e));
    });

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

/**
 * If invoked directly, start the server.
 */
if (require.main === module) {
  start();
}

