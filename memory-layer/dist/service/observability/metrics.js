"use strict";
// memory-layer/service/observability/metrics.ts
/**
 * Memory Layer observability: Prometheus metrics + helpers.
 *
 * Usage:
 *   import { initMetrics, metricsMiddleware, metrics } from './observability/metrics';
 *   initMetrics(); // early in server startup
 *   app.get('/metrics', metricsMiddleware); // expose metrics endpoint (or wire via ingress)
 *
 * Call helpers:
 *   metrics.ingestion.inc({ owner: 'kernel' });
 *   metrics.vectorWrite.observe({ provider: 'postgres', namespace: 'kernel-memory' }, durationSeconds);
 *
 * Notes:
 *  - Add "prom-client" to package.json dependencies.
 *  - The module is defensive: if MEMORY_METRICS_ENABLED=false, helpers become no-ops and /metrics
 *    returns a small text message to indicate metrics disabled.
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
exports.metricsContentType = exports.metrics = void 0;
exports.initMetrics = initMetrics;
exports.metricsMiddleware = metricsMiddleware;
const prom_client_1 = __importStar(require("prom-client"));
const METRICS_ENABLED = String(process.env.MEMORY_METRICS_ENABLED ?? 'true').toLowerCase() !== 'false';
const SERVICE_NAME = process.env.SERVICE_NAME ?? 'memory-layer';
// Prom-client registry
const registry = new prom_client_1.Registry();
// Attach service label to all metrics for easy multi-service scraping
registry.setDefaultLabels({ service: SERVICE_NAME });
// Default Node metrics collection
if (METRICS_ENABLED) {
    (0, prom_client_1.collectDefaultMetrics)({ register: registry });
}
/**
 * Metric definitions
 *
 * Labels are chosen to be informative for slicing in Prometheus.
 */
let ingestionCounter;
let memoryNodesCreatedCounter;
let memoryNodesDeletedCounter;
let vectorWriteHistogram;
let vectorWriteSuccessCounter;
let vectorWriteFailureCounter;
let vectorQueueDepthGauge;
let vectorWorkerProcessedCounter;
let vectorWorkerErrorCounter;
let searchLatencyHistogram;
let searchLatencySummary;
let searchRequestsCounter;
let auditSignFailuresCounter;
let auditSignDurationHistogram;
let ttlCleanerProcessedCounter;
let ttlCleanerErrorCounter;
let piiRedactionCounter;
let piiReadDeniedCounter;
/**
 * Initialize and register metrics.
 * Safe to call multiple times; does nothing after first initialization.
 */
let initialized = false;
function initMetrics() {
    if (!METRICS_ENABLED) {
        // metrics disabled - keep functions as no-ops
        console.info('[metrics] Prometheus metrics disabled via MEMORY_METRICS_ENABLED=false');
        return;
    }
    if (initialized)
        return;
    initialized = true;
    // Counters
    ingestionCounter = new prom_client_1.default.Counter({
        name: 'memory_ingestion_total',
        help: 'Total number of memory node ingestions',
        labelNames: ['owner', 'result'],
        registers: [registry]
    });
    memoryNodesCreatedCounter = new prom_client_1.default.Counter({
        name: 'memory_nodes_created_total',
        help: 'Total memory nodes created',
        labelNames: ['owner'],
        registers: [registry]
    });
    memoryNodesDeletedCounter = new prom_client_1.default.Counter({
        name: 'memory_nodes_deleted_total',
        help: 'Total memory nodes soft-deleted',
        labelNames: ['owner', 'reason'],
        registers: [registry]
    });
    vectorWriteHistogram = new prom_client_1.default.Histogram({
        name: 'memory_vector_write_seconds',
        help: 'Histogram of vector write durations (seconds)',
        labelNames: ['provider', 'namespace', 'owner'],
        // buckets tuned for small->large embeddings; adjust as needed
        buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
        registers: [registry]
    });
    vectorWriteSuccessCounter = new prom_client_1.default.Counter({
        name: 'memory_vector_write_success_total',
        help: 'Total successful vector writes',
        labelNames: ['provider', 'namespace'],
        registers: [registry]
    });
    vectorWriteFailureCounter = new prom_client_1.default.Counter({
        name: 'memory_vector_write_failure_total',
        help: 'Total failed vector writes',
        labelNames: ['provider', 'namespace', 'error'],
        registers: [registry]
    });
    vectorQueueDepthGauge = new prom_client_1.default.Gauge({
        name: 'memory_vector_queue_depth',
        help: 'Current depth of the memory_vectors pending queue',
        labelNames: ['provider', 'namespace'],
        registers: [registry]
    });
    vectorWorkerProcessedCounter = new prom_client_1.default.Counter({
        name: 'memory_vector_worker_processed_total',
        help: 'Number of vector worker processed rows',
        labelNames: ['result'],
        registers: [registry]
    });
    vectorWorkerErrorCounter = new prom_client_1.default.Counter({
        name: 'memory_vector_worker_errors_total',
        help: 'Number of errors encountered by vector worker',
        labelNames: ['error'],
        registers: [registry]
    });
    searchLatencyHistogram = new prom_client_1.default.Histogram({
        name: 'memory_search_seconds',
        help: 'Histogram of memory search latency (seconds)',
        labelNames: ['namespace'],
        buckets: [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1],
        registers: [registry]
    });
    // Summary provides quantiles client-side (useful for p95).
    searchLatencySummary = new prom_client_1.default.Summary({
        name: 'memory_search_latency_summary',
        help: 'Summary of memory search latency for quantiles (p50, p90, p95)',
        labelNames: ['namespace'],
        percentiles: [0.5, 0.9, 0.95],
        registers: [registry]
    });
    searchRequestsCounter = new prom_client_1.default.Counter({
        name: 'memory_search_requests_total',
        help: 'Total memory search requests',
        labelNames: ['namespace'],
        registers: [registry]
    });
    auditSignFailuresCounter = new prom_client_1.default.Counter({
        name: 'memory_audit_sign_failures_total',
        help: 'Total audit signature failures',
        labelNames: ['reason'],
        registers: [registry]
    });
    auditSignDurationHistogram = new prom_client_1.default.Histogram({
        name: 'memory_audit_sign_seconds',
        help: 'Duration of audit signing operations',
        labelNames: ['method'],
        buckets: [0.001, 0.005, 0.01, 0.02, 0.05, 0.1],
        registers: [registry]
    });
    ttlCleanerProcessedCounter = new prom_client_1.default.Counter({
        name: 'memory_ttl_cleaner_processed_total',
        help: 'Number of TTL-cleaner processed nodes',
        labelNames: ['result'],
        registers: [registry]
    });
    ttlCleanerErrorCounter = new prom_client_1.default.Counter({
        name: 'memory_ttl_cleaner_errors_total',
        help: 'Number of TTL-cleaner errors',
        labelNames: ['error'],
        registers: [registry]
    });
    piiRedactionCounter = new prom_client_1.default.Counter({
        name: 'memory_pii_redaction_total',
        help: 'Number of responses redacted for PII',
        labelNames: ['endpoint'],
        registers: [registry]
    });
    piiReadDeniedCounter = new prom_client_1.default.Counter({
        name: 'memory_pii_read_denied_total',
        help: 'Number of attempts denied to read PII',
        labelNames: ['caller'],
        registers: [registry]
    });
    // Make a final log
    console.info('[metrics] Prometheus metrics initialized and default metrics collected.');
}
/**
 * Expose /metrics handler for Express.
 * If metrics disabled, return small text response.
 */
async function metricsMiddleware(req, res, next) {
    if (!METRICS_ENABLED) {
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.status(200).send('# metrics disabled');
        return;
    }
    try {
        const metrics = await registry.metrics();
        res.setHeader('content-type', registry.contentType);
        res.status(200).send(metrics);
    }
    catch (err) {
        next(err);
    }
}
/**
 * Helper functions: call these from other modules.
 * All helpers are safe no-ops if metrics disabled.
 */
exports.metrics = {
    // Ingestion
    ingestion: {
        inc: (labels = {}) => {
            if (!METRICS_ENABLED)
                return;
            ingestionCounter?.inc({ owner: labels.owner ?? 'unknown', result: labels.result ?? 'success' });
        }
    },
    // Memory node lifecycle
    memoryNode: {
        created: (labels = {}) => {
            if (!METRICS_ENABLED)
                return;
            memoryNodesCreatedCounter?.inc({ owner: labels.owner ?? 'unknown' });
        },
        deleted: (labels = {}) => {
            if (!METRICS_ENABLED)
                return;
            memoryNodesDeletedCounter?.inc({ owner: labels.owner ?? 'unknown', reason: labels.reason ?? 'ttl' });
        }
    },
    // Vector writes
    vectorWrite: {
        observe: (labels = {}, seconds) => {
            if (!METRICS_ENABLED)
                return;
            vectorWriteHistogram?.observe({ provider: labels.provider ?? 'postgres', namespace: labels.namespace ?? 'kernel-memory', owner: labels.owner ?? 'unknown' }, seconds);
        },
        success: (labels = {}) => {
            if (!METRICS_ENABLED)
                return;
            vectorWriteSuccessCounter?.inc({ provider: labels.provider ?? 'postgres', namespace: labels.namespace ?? 'kernel-memory' });
        },
        failure: (labels = {}) => {
            if (!METRICS_ENABLED)
                return;
            vectorWriteFailureCounter?.inc({ provider: labels.provider ?? 'postgres', namespace: labels.namespace ?? 'kernel-memory', error: labels.error ?? 'unknown' });
        }
    },
    // Vector queue state
    vectorQueue: {
        setDepth: (depth, labels = {}) => {
            if (!METRICS_ENABLED)
                return;
            vectorQueueDepthGauge?.set({ provider: labels.provider ?? 'postgres', namespace: labels.namespace ?? 'kernel-memory' }, depth);
        },
        workerProcessed: (labels = { result: 'completed' }) => {
            if (!METRICS_ENABLED)
                return;
            vectorWorkerProcessedCounter?.inc({ result: labels.result ?? 'completed' });
        },
        workerError: (errLabel) => {
            if (!METRICS_ENABLED)
                return;
            vectorWorkerErrorCounter?.inc({ error: errLabel ?? 'unknown' });
        }
    },
    // Search
    search: {
        observe: (labels = {}, seconds) => {
            if (!METRICS_ENABLED)
                return;
            searchLatencyHistogram?.observe({ namespace: labels.namespace ?? 'kernel-memory' }, seconds);
            searchLatencySummary?.observe({ namespace: labels.namespace ?? 'kernel-memory' }, seconds);
            searchRequestsCounter?.inc({ namespace: labels.namespace ?? 'kernel-memory' });
        }
    },
    // Audit signing
    audit: {
        failure: (labels = {}) => {
            if (!METRICS_ENABLED)
                return;
            auditSignFailuresCounter?.inc({ reason: labels.reason ?? 'unknown' });
        },
        duration: (labels = {}, seconds) => {
            if (!METRICS_ENABLED)
                return;
            auditSignDurationHistogram?.observe({ method: labels.method ?? 'kms' }, seconds);
        }
    },
    // TTL cleaner
    ttlCleaner: {
        processed: (labels = {}) => {
            if (!METRICS_ENABLED)
                return;
            ttlCleanerProcessedCounter?.inc({ result: labels.result ?? 'processed' });
        },
        error: (labels = {}) => {
            if (!METRICS_ENABLED)
                return;
            ttlCleanerErrorCounter?.inc({ error: labels.error ?? 'unknown' });
        }
    },
    // PII redaction & access
    pii: {
        redaction: (labels = {}) => {
            if (!METRICS_ENABLED)
                return;
            piiRedactionCounter?.inc({ endpoint: labels.endpoint ?? 'unknown' });
        },
        readDenied: (labels = {}) => {
            if (!METRICS_ENABLED)
                return;
            piiReadDeniedCounter?.inc({ caller: labels.caller ?? 'unknown' });
        }
    },
    // Expose registry for advanced uses
    registry
};
/**
 * Convenience: returns content-type header for metrics
 */
const metricsContentType = () => (METRICS_ENABLED ? registry.contentType : 'text/plain; charset=utf-8');
exports.metricsContentType = metricsContentType;
// Initialize on import if desired (but we also expose initMetrics to be explicit)
if (METRICS_ENABLED) {
    try {
        initMetrics();
    }
    catch (err) {
        // fail-open: log and continue (server should still start)
        // eslint-disable-next-line no-console
        console.error('[metrics] failed to initialize metrics:', err.message || err);
    }
}
exports.default = {
    initMetrics,
    metricsMiddleware,
    metrics: exports.metrics,
    registry,
    metricsContentType: exports.metricsContentType
};
