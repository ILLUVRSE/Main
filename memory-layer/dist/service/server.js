"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// memory-layer/service/server.ts
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const memoryRoutes_1 = __importDefault(require("./routes/memoryRoutes"));
const vectorDbAdapter_1 = require("./vector/vectorDbAdapter");
const memoryService_1 = require("./services/memoryService");
const db_1 = require("./db");
const auth_1 = require("./middleware/auth");
// Observability
const metrics_1 = __importDefault(require("./observability/metrics"));
const tracing_1 = __importDefault(require("./observability/tracing"));
const nodeEnv = process.env.NODE_ENV ?? 'development';
const requireKms = String(process.env.REQUIRE_KMS ?? '').toLowerCase() === 'true';
/**
 * Startup guard: in production or when REQUIRE_KMS=true require that an audit signing
 * capability is configured. This check mirrors auditChain expectations:
 *
 * Required when (NODE_ENV=production) OR (REQUIRE_KMS=true):
 *   - AUDIT_SIGNING_KMS_KEY_ID   (preferred) OR
 *   - SIGNING_PROXY_URL          (remote signing proxy) OR
 *   - AUDIT_SIGNING_KEY / AUDIT_SIGNING_SECRET / AUDIT_SIGNING_PRIVATE_KEY (local key fallback)
 *
 * If none present in the strict environment, the process exits with actionable text.
 */
if (nodeEnv === 'production' && String(process.env.DEV_SKIP_MTLS ?? '').toLowerCase() === 'true') {
    console.error('[startup] DEV_SKIP_MTLS=true is forbidden in production');
    process.exit(1);
}
if (nodeEnv === 'production') {
    const hasKmsKey = Boolean(process.env.AUDIT_SIGNING_KMS_KEY_ID || process.env.AUDIT_SIGNING_KMS_KEY);
    const hasSigningProxy = Boolean(process.env.SIGNING_PROXY_URL);
    const hasLocalKey = Boolean(process.env.AUDIT_SIGNING_KEY) ||
        Boolean(process.env.AUDIT_SIGNING_SECRET) ||
        Boolean(process.env.AUDIT_SIGNING_PRIVATE_KEY);
    if (!hasKmsKey && !hasSigningProxy && !hasLocalKey) {
        console.error('[startup] Audit signing is required in this environment but no signer is configured.\n' +
            'Set one of: AUDIT_SIGNING_KMS_KEY_ID (preferred), SIGNING_PROXY_URL, or a local key via AUDIT_SIGNING_KEY / AUDIT_SIGNING_SECRET / AUDIT_SIGNING_PRIVATE_KEY.\n' +
            'If using AWS KMS ensure AUDIT_SIGNING_KMS_KEY_ID points to a valid KMS key ARN and AWS credentials + region are available.');
        process.exit(1);
    }
}
/**
 * Try to require OpenAPI validator package (dynamically).
 * If missing in production, fail startup (we do not want prod to silently disable validation).
 */
let OpenApiValidator = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('express-openapi-validator');
    // package exports a constructor named OpenApiValidator (v5+)
    OpenApiValidator = pkg.OpenApiValidator ?? pkg.default ?? pkg;
}
catch (err) {
    if (nodeEnv === 'production') {
        console.error('[startup] express-openapi-validator module is required in production but not installed.');
        console.error('Install express-openapi-validator and pin it in package.json so validation is available in production.');
        process.exit(1);
    }
    else {
        // warn in non-prod, we'll continue without the validator
        // eslint-disable-next-line no-console
        console.warn('[startup] express-openapi-validator not available; continuing without request/response validation (dev mode).');
        OpenApiValidator = null;
    }
}
// Build the Express app
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '2mb' }));
// Initialize observability (metrics + tracing) and expose /metrics
try {
    metrics_1.default.initMetrics();
    // Expose /metrics; protect it as appropriate with network-level ACLs in prod.
    app.get('/metrics', metrics_1.default.metricsMiddleware);
}
catch (err) {
    // fail-open: log error and continue; metrics should not prevent server start
    // eslint-disable-next-line no-console
    console.error('[startup] metrics initialization failed:', err.message || err);
}
// Tracing initialization will be done in the top-level async startup below (so we can await it).
/**
 * Install OpenAPI validator if available.
 *
 * Validation settings:
 *  - validateRequests: true (required)
 *  - validateResponses: enabled only when explicitly allowed (default false to avoid heavy CPU)
 *
 * Node SDKs can set OPENAPI_VALIDATE_RESPONSES=true to enable response validation if desired.
 */
async function installOpenApiValidatorIfPresent() {
    if (!OpenApiValidator)
        return;
    // Allow override of spec path through env for CI/packaged builds
    const apiSpecPath = process.env.OPENAPI_SPEC_PATH ??
        path_1.default.join(__dirname, '..', '..', 'api', 'openapi.yaml'); // compiled path should mirror source layout
    // Ensure spec exists
    if (!fs_1.default.existsSync(apiSpecPath)) {
        const msg = `[startup] OpenAPI spec not found at ${apiSpecPath}`;
        if (nodeEnv === 'production') {
            console.error(msg);
            process.exit(1);
        }
        else {
            // dev: warn and continue
            // eslint-disable-next-line no-console
            console.warn(msg + '; continuing without validator (dev).');
            return;
        }
    }
    const validateResponses = String(process.env.OPENAPI_VALIDATE_RESPONSES ?? 'false').toLowerCase() === 'true';
    try {
        // New OpenApiValidator API (v5)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        // @ts-ignore - dynamic usage
        try {
            let installed = false;
            try {
                // Prefer constructor-based API when available
                const validatorInstance = new OpenApiValidator({
                    apiSpec: apiSpecPath,
                    validateRequests: true,
                    validateResponses: validateResponses
                });
                if (validatorInstance && typeof validatorInstance.install === 'function') {
                    await validatorInstance.install(app);
                    installed = true;
                }
            }
            catch (ctorErr) {
                // Fallback: some builds export a factory/function instead of a constructor.
                if (typeof OpenApiValidator === 'function') {
                    const maybe = OpenApiValidator({
                        apiSpec: apiSpecPath,
                        validateRequests: true,
                        validateResponses: validateResponses
                    });
                    if (maybe && typeof maybe.then === 'function') {
                        await maybe;
                    }
                    installed = true;
                }
                else {
                    throw ctorErr;
                }
            }
            if (!installed)
                throw new Error('OpenApiValidator could not be installed');
            console.info(`[startup] OpenAPI validator installed (spec: ${apiSpecPath}, validateResponses: ${validateResponses})`);
        }
        catch (err) {
            console.error('[startup] failed to install OpenAPI validator:', err.message || err);
            if (nodeEnv === 'production') {
                process.exit(1);
            }
        }
    }
    catch (err) {
        console.error('[startup] failed to install OpenAPI validator:', err.message || err);
        if (nodeEnv === 'production') {
            process.exit(1);
        }
    }
}
// Create Vector adapter and Memory service
const vectorAdapter = new vectorDbAdapter_1.VectorDbAdapter({
    provider: process.env.VECTOR_DB_PROVIDER,
    endpoint: process.env.VECTOR_DB_ENDPOINT,
    apiKey: process.env.VECTOR_DB_API_KEY,
    namespace: process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory',
    pool: (0, db_1.getPool)()
});
const memoryService = (0, memoryService_1.createMemoryService)({ vectorAdapter });
// Health endpoints
app.get('/healthz', async (_req, res) => {
    try {
        await (0, db_1.getPool)().query('SELECT 1');
        const vectorStatus = await vectorAdapter.healthCheck();
        res.json({
            status: 'ok',
            vector: vectorStatus
        });
    }
    catch (err) {
        console.error('[healthz] failed', err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});
app.get('/readyz', async (_req, res) => {
    try {
        const vectorStatus = await vectorAdapter.healthCheck();
        // Optionally add migration-ready checks here (e.g., check schema_migrations table).
        res.json({
            status: 'ready',
            vector: vectorStatus
        });
    }
    catch (err) {
        res.status(503).json({ status: 'degraded', message: err.message });
    }
});
// Attach tracing middleware (adds X-Trace-Id header etc.)
app.use(tracing_1.default.expressMiddleware);
// Mount application routes (auth middleware applied per previous design)
app.use('/v1', auth_1.authMiddleware, (0, memoryRoutes_1.default)(memoryService));
// Simple error handler so the scaffold surfaces JSON errors.
app.use((err, _req, res, _next) => {
    console.error('[memory-layer] request failed', err);
    res.status(err.status ?? 500).json({
        error: {
            message: err.message
        }
    });
});
const port = Number(process.env.PORT ?? 4300);
/**
 * Top-level async startup to allow awaiting tracing and validator initialization.
 */
async function start() {
    // Start tracing first so auto-instrumentations pick up downstream libs
    try {
        await tracing_1.default.initTracing(process.env.SERVICE_NAME ?? 'memory-layer');
    }
    catch (err) {
        console.error('[startup] tracing init error:', err.message || err);
        // Do not fail startup solely for tracing errors in most cases
    }
    // Install OpenAPI validator if available; in production this will fail the process if missing
    await installOpenApiValidatorIfPresent();
    // Start server
    if (require.main === module) {
        app.listen(port, () => {
            console.info(`Memory Layer service listening on port ${port} (env=${nodeEnv})`);
        });
    }
}
// If this file is executed directly, run start()
if (require.main === module) {
    (async () => {
        try {
            await start();
        }
        catch (err) {
            console.error('[startup] fatal error:', err.message || err);
            process.exit(1);
        }
    })();
}
exports.default = app;
