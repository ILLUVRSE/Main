/**
 * kernel/src/server.ts
 *
 * Production-minded Kernel HTTP server entrypoint.
 *
 * Changes:
 *  - Reads MTLS env vars and starts HTTPS server with client cert options when configured.
 *  - Initializes OIDC (if configured) and installs auth middleware.
 *  - Keeps dev-mode behavior (skip DB/migrations) when NODE_ENV=development.
 *
 * Notes:
 * - This file intentionally avoids adding new runtime dependencies beyond what's needed.
 * - DO NOT COMMIT SECRETS — use Vault/KMS and environment variables.
 */
import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import https from 'https';
import yaml from 'js-yaml';
import createKernelRouter from './routes/kernelRoutes';
import { waitForDb, runMigrations } from './db';
import { initOidc } from './auth/oidc';
import { authMiddleware } from './auth/middleware';
import { getPrincipalFromRequest, requireRoles, requireAnyAuthenticated, Roles } from './rbac';

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

// Enable test endpoints in CI/dev explicitly via ENABLE_TEST_ENDPOINTS=true,
// and always enable them when running under the Jest test environment (NODE_ENV=test).
const ENABLE_TEST_ENDPOINTS =
  (process.env.ENABLE_TEST_ENDPOINTS || '').toLowerCase() === 'true' || NODE_ENV === 'test';

const LOG_PREFIX = '[kernel:' + NODE_ENV + ']';

/**
 * Minimal structured logger helpers
 */
function info(...args: any[]) { console.info(LOG_PREFIX, ...args); }
function warn(...args: any[]) { console.warn(LOG_PREFIX, ...args); }
function error(...args: any[]) { console.error(LOG_PREFIX, ...args); }
function debug(...args: any[]) { if ((process.env.LOG_LEVEL || '').toLowerCase() === 'debug') console.debug(LOG_PREFIX, ...args); }

/**
 * Simple in-memory metrics (Prometheus exposition format)
 */
const metrics = {
  server_start_total: 0,
  readiness_success_total: 0,
  readiness_failure_total: 0,
  kms_probe_success_total: 0,
  kms_probe_failure_total: 0,
};

function metricsText(): string {
  // Simple exposition - counters only
  return [
    '# HELP kernel_server_start_total Count of server starts',
    '# TYPE kernel_server_start_total counter',
    'kernel_server_start_total ' + metrics.server_start_total,
    '# HELP kernel_readiness_success_total Count of successful readiness probes',
    '# TYPE kernel_readiness_success_total counter',
    'kernel_readiness_success_total ' + metrics.readiness_success_total,
    '# HELP kernel_readiness_failure_total Count of failed readiness probes',
    '# TYPE kernel_readiness_failure_total counter',
    'kernel_readiness_failure_total ' + metrics.readiness_failure_total,
    '# HELP kernel_kms_probe_success_total Count of successful KMS probes',
    '# TYPE kernel_kms_probe_success_total counter',
    'kernel_kms_probe_success_total ' + metrics.kms_probe_success_total,
    '# HELP kernel_kms_probe_failure_total Count of failed KMS probes',
    '# TYPE kernel_kms_probe_failure_total counter',
    'kernel_kms_probe_failure_total ' + metrics.kms_probe_failure_total,
    '',
  ].join('\n');
}

/**
 * checkKmsReachable
 * Attempts to contact the KMS_ENDPOINT (if configured) with a GET and timeout.
 * Returns true if reachable (any HTTP response), false on network errors/timeout.
 *
 * NOTE: This function reads the KMS_ENDPOINT constant defined above (from process.env at module load).
 */
export async function checkKmsReachable(timeoutMs = 3000): Promise<boolean> {
  if (!KMS_ENDPOINT) return false;
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    // @ts-ignore global fetch exists in Node 18+; using as any for compatibility
    const res = await (globalThis as any).fetch(KMS_ENDPOINT, { method: 'GET', signal: controller.signal });
    clearTimeout(id);
    // If we got any HTTP response, treat KMS as reachable
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * readinessCheck
 * - Verifies DB is reachable via waitForDb (quick timeout)
 * - Verifies KMS if REQUIRE_KMS==true or KMS_ENDPOINT provided
 */
async function readinessCheck(): Promise<{ ok: boolean; details?: string }> {
  try {
    // DB check (short timeout)
    try {
      await waitForDb(5_000, 500); // short wait
    } catch (e) {
      metrics.readiness_failure_total++;
      return { ok: false, details: 'db.unreachable' };
    }

    // KMS check if configured or required
    if (REQUIRE_KMS || KMS_ENDPOINT) {
      const reachable = await checkKmsReachable(3000);
      if (!reachable) {
        metrics.kms_probe_failure_total++;
        metrics.readiness_failure_total++;
        return { ok: false, details: 'kms.unreachable' };
      }
      metrics.kms_probe_success_total++;
    }

    metrics.readiness_success_total++;
    return { ok: true };
  } catch (err) {
    metrics.readiness_failure_total++;
    return { ok: false, details: (err as Error).message || 'unknown' };
  }
}

/**
 * Load OpenAPI validator robustly (support multiple export shapes)
 */
async function tryInstallOpenApiValidator(app: express.Express, apiSpec: any) {
  try {
    // Try dynamic require and discover common export shapes
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const OpenApiValidatorModule: any = require('express-openapi-validator');
    const ValidatorCtor: any =
      OpenApiValidatorModule?.OpenApiValidator ||
      OpenApiValidatorModule?.default ||
      OpenApiValidatorModule;

    if (!ValidatorCtor || typeof ValidatorCtor !== 'function') {
      throw new Error('express-openapi-validator export shape not recognized');
    }

    // instantiate and install
    const instance: any = new ValidatorCtor({ apiSpec, validateRequests: true, validateResponses: false });
    if (typeof instance.install === 'function') {
      await instance.install(app);
      info('OpenAPI validation enabled using ' + OPENAPI_PATH);
    } else {
      throw new Error('OpenApiValidator instance does not expose install(app)');
    }
  } catch (err) {
    warn('Failed to load/install OpenAPI validator:', (err as Error).message || err);
  }
}

/**
 * createApp
 */
export async function createApp() {
  const app = express();
  app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));

  // auth middleware (OIDC / mTLS) - best-effort placement early in chain
  try {
    app.use(authMiddleware as any);
  } catch (e) {
    warn('Failed to install auth middleware:', (e as Error).message || e);
  }

  // simple request logging
  app.use((req, _res, next) => {
    debug(req.method + ' ' + req.path);
    next();
  });

  // Try to load OpenAPI spec
  if (fs.existsSync(OPENAPI_PATH)) {
    try {
      const raw = fs.readFileSync(OPENAPI_PATH, 'utf8');
      const apiSpec = yaml.load(raw) as object;
      await tryInstallOpenApiValidator(app, apiSpec);
    } catch (err) {
      warn('OpenAPI load failed:', (err as Error).message || err);
    }
  } else {
    warn('OpenAPI not found at ' + OPENAPI_PATH + ' - request validation disabled.');
  }

  // Mount kernel router
  app.use('/', createKernelRouter());

  // ===== Test-only endpoints (guarded) =====
  if (ENABLE_TEST_ENDPOINTS) {
    info('ENABLE_TEST_ENDPOINTS=true -> installing test-only endpoints: /principal /require-any /require-roles');

    // Return the computed/attached principal (does not enforce auth)
    app.get('/principal', (req: Request, res: Response) => {
      const principal = (req as any).principal ?? getPrincipalFromRequest(req as any);
      (req as any).principal = principal;
      return res.json({ principal } as any);
    });

    // Require any authenticated principal (human or service)
    app.get('/require-any', requireAnyAuthenticated, (req: Request, res: Response) => {
      return res.json({ ok: true, principal: (req as any).principal } as any);
    });

    // Require at least one of the roles (SuperAdmin OR Operator) for access
    app.get(
      '/require-roles',
      requireRoles(Roles.SUPERADMIN, Roles.OPERATOR),
      (req: Request, res: Response) => {
        return res.json({ ok: true, principal: (req as any).principal } as any);
      }
    );
  }

  // Liveness endpoint
  app.get('/health', (_req: Request, res: Response) => {
    return res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  // Readiness endpoint - runs quick checks (DB + optional KMS)
  app.get('/ready', async (_req: Request, res: Response) => {
    const r = await readinessCheck();
    if (!r.ok) return res.status(503).json({ status: 'not_ready', details: r.details ?? null });
    return res.json({ status: 'ready' });
  });

  // Metrics endpoint
  app.get('/metrics', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(metricsText());
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
 * - Validates KMS presence when NODE_ENV=production && REQUIRE_KMS=true
 * - Initializes OIDC if configured
 * - Waits for DB then runs migrations and starts HTTP or HTTPS server (mTLS) depending on env
 */
async function start() {
  try {
    info('Kernel server starting...');
    info('NODE_ENV=' + NODE_ENV + ' REQUIRE_KMS=' + REQUIRE_KMS + ' KMS_ENDPOINT=' + (KMS_ENDPOINT ? 'configured' : 'unset'));

    // If in production and KMS is required, fail fast if KMS_ENDPOINT missing or unreachable
    if (NODE_ENV === 'production' && REQUIRE_KMS) {
      if (!KMS_ENDPOINT) {
        error('Fatal: REQUIRE_KMS=true and KMS_ENDPOINT is not set. Exiting.');
        process.exit(1);
      }
      // Probe KMS quickly
      info('Probing KMS endpoint for reachability...');
      const ok = await checkKmsReachable(3_000);
      if (!ok) {
        error('Fatal: REQUIRE_KMS=true but KMS_ENDPOINT is unreachable. Exiting.');
        metrics.kms_probe_failure_total++;
        process.exit(1);
      }
      info('KMS probe succeeded.');
      metrics.kms_probe_success_total++;
    }

    // Initialize OIDC if configured (best-effort)
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

    // Wait for DB then run migrations (skip in development)
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

    // Create app
    const app = await createApp();

    // Decide HTTP vs HTTPS (mTLS)
    if (MTLS_CERT && MTLS_KEY) {
      info('Starting HTTPS server (mTLS config present). MTLS_REQUIRE_CLIENT_CERT=' + MTLS_REQUIRE_CLIENT_CERT);
      try {
        const tlsOptions: https.ServerOptions = {
          key: fs.readFileSync(MTLS_KEY),
          cert: fs.readFileSync(MTLS_CERT),
          requestCert: MTLS_REQUIRE_CLIENT_CERT,
          rejectUnauthorized: MTLS_REQUIRE_CLIENT_CERT,
        };
        if (MTLS_CLIENT_CA) {
          try {
            tlsOptions.ca = fs.readFileSync(MTLS_CLIENT_CA);
          } catch (e) {
            warn('Failed to read MTLS_CLIENT_CA:', (e as Error).message || e);
          }
        }
        const server = https.createServer(tlsOptions, app).listen(PORT, () => {
          metrics.server_start_total++;
          info('Kernel HTTPS server listening on port ' + PORT);
          readinessCheck().then((r) => {
            if (!r.ok) warn('Initial readiness check failed:', r.details);
            else info('Initial readiness check succeeded');
          }).catch((e) => warn('Initial readiness check error:', (e as Error).message || e));
        });
        // Graceful shutdown wiring
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

    // Fallback: plain HTTP
    const server = app.listen(PORT, () => {
      metrics.server_start_total++;
      info('Kernel server listening on port ' + PORT);
      readinessCheck().then((r) => {
        if (!r.ok) warn('Initial readiness check failed:', r.details);
        else info('Initial readiness check succeeded');
      }).catch((e) => warn('Initial readiness check error:', (e as Error).message || e));
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

/**
 * If invoked directly, start the server.
 */
if (require.main === module) {
  start();
}

