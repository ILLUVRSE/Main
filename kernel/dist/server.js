"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const kernelRoutes_1 = __importDefault(require("./routes/kernelRoutes"));
const db_1 = require("./db");
const prometheus_1 = require("./metrics/prometheus");
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const REQUIRE_KMS = (process.env.REQUIRE_KMS || 'false').toLowerCase() === 'true';
const KMS_ENDPOINT = (process.env.KMS_ENDPOINT || '').replace(/\/$/, '');
const OPENAPI_PATH = process.env.OPENAPI_PATH
    ? path_1.default.resolve(process.cwd(), process.env.OPENAPI_PATH)
    : path_1.default.resolve(__dirname, '../openapi.yaml');
const LOG_PREFIX = '[kernel:' + NODE_ENV + ']';
/** Logging helpers */
function info(...args) { console.info(LOG_PREFIX, ...args); }
function warn(...args) { console.warn(LOG_PREFIX, ...args); }
function error(...args) { console.error(LOG_PREFIX, ...args); }
function debug(...args) { if ((process.env.LOG_LEVEL || '').toLowerCase() === 'debug')
    console.debug(LOG_PREFIX, ...args); }
/** Probe KMS reachability (best-effort) */
async function checkKmsReachable(timeoutMs = 3000) {
    if (!KMS_ENDPOINT)
        return false;
    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        // @ts-ignore global fetch exists in Node 18+ in many environments
        const res = await globalThis.fetch(KMS_ENDPOINT, { method: 'GET', signal: controller.signal });
        clearTimeout(id);
        return true;
    }
    catch (err) {
        return false;
    }
}
/** Readiness checks: DB and KMS (if required) */
async function readinessCheck() {
    // DB quick check
    try {
        await (0, db_1.waitForDb)(5_000, 500);
    }
    catch (e) {
        (0, prometheus_1.incrementReadinessFailure)();
        return { ok: false, details: 'db.unreachable' };
    }
    // KMS check when required/configured
    if (REQUIRE_KMS || KMS_ENDPOINT) {
        const reachable = await checkKmsReachable(3000);
        if (!reachable) {
            (0, prometheus_1.incrementKmsProbeFailure)();
            (0, prometheus_1.incrementReadinessFailure)();
            return { ok: false, details: 'kms.unreachable' };
        }
        (0, prometheus_1.incrementKmsProbeSuccess)();
    }
    (0, prometheus_1.incrementReadinessSuccess)();
    return { ok: true };
}
/** Try to install OpenAPI validator if available (best-effort) */
async function tryInstallOpenApiValidator(app, apiSpec) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const OpenApiValidatorModule = require('express-openapi-validator');
        const middlewareFactory = OpenApiValidatorModule?.middleware ||
            OpenApiValidatorModule?.default?.middleware;
        const validatorOptions = { apiSpec, validateRequests: true, validateResponses: false };
        if (typeof middlewareFactory === 'function') {
            app.use(middlewareFactory(validatorOptions));
            info('OpenAPI validation enabled using ' + OPENAPI_PATH);
            return;
        }
        const ValidatorCtor = OpenApiValidatorModule?.OpenApiValidator ||
            OpenApiValidatorModule?.default?.OpenApiValidator ||
            OpenApiValidatorModule?.default ||
            OpenApiValidatorModule;
        if (ValidatorCtor && typeof ValidatorCtor === 'function') {
            const instance = new ValidatorCtor(validatorOptions);
            if (typeof instance.install === 'function') {
                await instance.install(app);
                info('OpenAPI validation enabled using ' + OPENAPI_PATH);
                return;
            }
        }
        throw new Error('express-openapi-validator export shape not recognized');
    }
    catch (err) {
        warn('Failed to load/install OpenAPI validator:', err.message || err);
    }
}
/**
 * createApp
 * Builds and returns an Express app instance.
 */
async function createApp() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));
    app.use((req, res, next) => {
        res.locals.routePath = req.path;
        const start = process.hrtime.bigint();
        let recorded = false;
        const record = () => {
            if (recorded)
                return;
            recorded = true;
            const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
            const routeLabel = res.locals.routePath || (req.route && req.route.path) || req.path || req.originalUrl || 'unknown';
            (0, prometheus_1.observeHttpRequest)({
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
    if (fs_1.default.existsSync(OPENAPI_PATH)) {
        try {
            const raw = fs_1.default.readFileSync(OPENAPI_PATH, 'utf8');
            const apiSpec = js_yaml_1.default.load(raw);
            await tryInstallOpenApiValidator(app, apiSpec);
        }
        catch (err) {
            warn('OpenAPI load failed:', err.message || err);
        }
    }
    else {
        warn('OpenAPI not found at ' + OPENAPI_PATH + ' - request validation disabled.');
    }
    // Mount kernel router
    app.use('/', (0, kernelRoutes_1.default)());
    // Liveness endpoint
    app.get('/health', (_req, res) => {
        return res.json({ status: 'ok', ts: new Date().toISOString() });
    });
    // Readiness endpoint
    app.get('/ready', async (_req, res) => {
        const r = await readinessCheck();
        if (!r.ok)
            return res.status(503).json({ status: 'not_ready', details: r.details ?? null });
        return res.json({ status: 'ready' });
    });
    // Metrics endpoint
    app.get('/metrics', (_req, res) => {
        res.setHeader('Content-Type', (0, prometheus_1.getMetricsContentType)());
        res.send((0, prometheus_1.getMetrics)());
    });
    // Generic error handler
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err, _req, res, _next) => {
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
        (0, prometheus_1.incrementServerStart)();
        if (NODE_ENV === 'production' && REQUIRE_KMS) {
            if (!KMS_ENDPOINT) {
                error('Fatal: REQUIRE_KMS=true and KMS_ENDPOINT is not set. Exiting.');
                process.exit(1);
            }
            info('Probing KMS endpoint for reachability...');
            const ok = await checkKmsReachable(3_000);
            if (!ok) {
                error('Fatal: REQUIRE_KMS=true but KMS_ENDPOINT is unreachable. Exiting.');
                (0, prometheus_1.incrementKmsProbeFailure)();
                process.exit(1);
            }
            info('KMS probe succeeded.');
            (0, prometheus_1.incrementKmsProbeSuccess)();
        }
        // Wait for DB and run migrations
        info('Waiting for Postgres...');
        await (0, db_1.waitForDb)(30_000, 500);
        try {
            info('Applying migrations...');
            await (0, db_1.runMigrations)();
            info('Migrations applied.');
        }
        catch (err) {
            warn('Migration runner failed (continuing):', err.message || err);
        }
        // Create and start app
        const app = await createApp();
        const server = app.listen(PORT, () => {
            (0, prometheus_1.incrementServerStart)();
            info('Kernel server listening on port ' + PORT);
            // Perform initial readiness check in background
            readinessCheck().then((r) => {
                if (!r.ok) {
                    warn('Initial readiness check failed:', r.details);
                }
                else {
                    info('Initial readiness check succeeded');
                }
            }).catch((e) => {
                warn('Initial readiness check error:', e.message || e);
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
    }
    catch (err) {
        error('Fatal error starting Kernel server:', err.message || err);
        process.exit(1);
    }
}
/** If invoked directly, start the server. */
if (require.main === module) {
    start();
}
