"use strict";
/**
 * kernel/src/routes/health.ts
 *
 * Centralised health/readiness helpers shared by both the top-level Express
 * server and the kernel routes module. Having a dedicated module keeps the
 * response contract consistent across entrypoints and makes it easier to test
 * failure scenarios by mocking the exported probe functions.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeDatabase = probeDatabase;
exports.probeKms = probeKms;
exports.resolveSloMetadata = resolveSloMetadata;
exports.buildHealthResponse = buildHealthResponse;
exports.readinessCheck = readinessCheck;
exports.createHealthRouter = createHealthRouter;
const express_1 = require("express");
const db_1 = require("../db");
const prometheus_1 = require("../metrics/prometheus");
const kms_1 = require("../config/kms");
const kms_2 = require("../services/kms");
const DEFAULT_SLO = {
    availability_target: process.env.SLO_AVAILABILITY_TARGET || '99.9%',
    latency_p99_ms: Number(process.env.SLO_LATENCY_P99_MS || 500),
    rto_seconds: Number(process.env.SLO_RTO_SECONDS || 60),
};
/**
 * probeDatabase attempts to query the database using waitForDb.
 * It resolves to true when the DB responds within the timeout window.
 */
async function probeDatabase(timeoutMs = 1_000) {
    try {
        await (0, db_1.waitForDb)(timeoutMs, Math.max(100, Math.floor(timeoutMs / 5)));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * probeKms uses the shared KMS configuration to determine reachability.
 */
async function probeKms(timeoutMs = 3_000) {
    const { endpoint } = (0, kms_1.loadKmsConfig)();
    if (!endpoint) {
        return false;
    }
    return (0, kms_2.probeKmsReachable)(endpoint, timeoutMs);
}
function resolveSloMetadata() {
    return {
        availability_target: process.env.SLO_AVAILABILITY_TARGET || DEFAULT_SLO.availability_target,
        latency_p99_ms: Number(process.env.SLO_LATENCY_P99_MS || DEFAULT_SLO.latency_p99_ms),
        rto_seconds: Number(process.env.SLO_RTO_SECONDS || DEFAULT_SLO.rto_seconds),
    };
}
async function buildHealthResponse() {
    // Import the module at runtime so jest.spyOn on exported functions affects these calls.
    const m = await Promise.resolve().then(() => __importStar(require('./health')));
    const [dbReachable, kmsReachable] = await Promise.all([m.probeDatabase(), m.probeKms()]);
    const { signerId } = (0, kms_1.loadKmsConfig)();
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
async function readinessCheck() {
    const { requireKms, endpoint } = (0, kms_1.loadKmsConfig)();
    // Call the probe via the module namespace so tests that spy on the exported functions work.
    const m = await Promise.resolve().then(() => __importStar(require('./health')));
    const dbReachable = await m.probeDatabase(5_000);
    if (!dbReachable) {
        (0, prometheus_1.incrementReadinessFailure)();
        return { ok: false, details: 'db.unreachable' };
    }
    if (requireKms || endpoint) {
        const reachable = await probeKms(3_000);
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
function createHealthRouter() {
    const router = (0, express_1.Router)();
    router.get('/health', async (_req, res) => {
        const payload = await buildHealthResponse();
        return res.json(payload);
    });
    router.get('/ready', async (_req, res) => {
        const result = await readinessCheck();
        if (!result.ok) {
            return res.status(503).json({ status: 'not_ready', details: result.details ?? null });
        }
        return res.json({ status: 'ready' });
    });
    return router;
}
exports.default = createHealthRouter;
