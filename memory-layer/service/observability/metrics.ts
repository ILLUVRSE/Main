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

import type { Request, Response, NextFunction } from 'express';
import client, {
  Registry,
  Counter,
  Gauge,
  Histogram,
  Summary,
  collectDefaultMetrics
} from 'prom-client';

const METRICS_ENABLED = String(process.env.MEMORY_METRICS_ENABLED ?? 'true').toLowerCase() !== 'false';
const SERVICE_NAME = process.env.SERVICE_NAME ?? 'memory-layer';

// Prom-client registry
const registry = new Registry();

// Attach service label to all metrics for easy multi-service scraping
registry.setDefaultLabels({ service: SERVICE_NAME });

// Default Node metrics collection
if (METRICS_ENABLED) {
  collectDefaultMetrics({ register: registry });
}

/**
 * Metric definitions
 *
 * Labels are chosen to be informative for slicing in Prometheus.
 */

let ingestionCounter: Counter<string>;
let memoryNodesCreatedCounter: Counter<string>;
let memoryNodesDeletedCounter: Counter<string>;

let vectorWriteHistogram: Histogram<string>;
let vectorWriteSuccessCounter: Counter<string>;
let vectorWriteFailureCounter: Counter<string>;

let vectorQueueDepthGauge: Gauge<string>;
let vectorWorkerProcessedCounter: Counter<string>;
let vectorWorkerErrorCounter: Counter<string>;

let searchLatencyHistogram: Histogram<string>;
let searchLatencySummary: Summary<string>;
let searchRequestsCounter: Counter<string>;

let auditSignFailuresCounter: Counter<string>;
let auditSignDurationHistogram: Histogram<string>;

let ttlCleanerProcessedCounter: Counter<string>;
let ttlCleanerErrorCounter: Counter<string>;

let piiRedactionCounter: Counter<string>;
let piiReadDeniedCounter: Counter<string>;

/**
 * Initialize and register metrics.
 * Safe to call multiple times; does nothing after first initialization.
 */
let initialized = false;

export function initMetrics() {
  if (!METRICS_ENABLED) {
    // metrics disabled - keep functions as no-ops
    console.info('[metrics] Prometheus metrics disabled via MEMORY_METRICS_ENABLED=false');
    return;
  }
  if (initialized) return;
  initialized = true;

  // Counters
  ingestionCounter = new client.Counter({
    name: 'memory_ingestion_total',
    help: 'Total number of memory node ingestions',
    labelNames: ['owner', 'result'] as const,
    registers: [registry]
  });

  memoryNodesCreatedCounter = new client.Counter({
    name: 'memory_nodes_created_total',
    help: 'Total memory nodes created',
    labelNames: ['owner'] as const,
    registers: [registry]
  });

  memoryNodesDeletedCounter = new client.Counter({
    name: 'memory_nodes_deleted_total',
    help: 'Total memory nodes soft-deleted',
    labelNames: ['owner', 'reason'] as const,
    registers: [registry]
  });

  vectorWriteHistogram = new client.Histogram({
    name: 'memory_vector_write_seconds',
    help: 'Histogram of vector write durations (seconds)',
    labelNames: ['provider', 'namespace', 'owner'] as const,
    // buckets tuned for small->large embeddings; adjust as needed
    buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry]
  });

  vectorWriteSuccessCounter = new client.Counter({
    name: 'memory_vector_write_success_total',
    help: 'Total successful vector writes',
    labelNames: ['provider', 'namespace'] as const,
    registers: [registry]
  });
  vectorWriteFailureCounter = new client.Counter({
    name: 'memory_vector_write_failure_total',
    help: 'Total failed vector writes',
    labelNames: ['provider', 'namespace', 'error'] as const,
    registers: [registry]
  });

  vectorQueueDepthGauge = new client.Gauge({
    name: 'memory_vector_queue_depth',
    help: 'Current depth of the memory_vectors pending queue',
    labelNames: ['provider', 'namespace'] as const,
    registers: [registry]
  });

  vectorWorkerProcessedCounter = new client.Counter({
    name: 'memory_vector_worker_processed_total',
    help: 'Number of vector worker processed rows',
    labelNames: ['result'] as const,
    registers: [registry]
  });

  vectorWorkerErrorCounter = new client.Counter({
    name: 'memory_vector_worker_errors_total',
    help: 'Number of errors encountered by vector worker',
    labelNames: ['error'] as const,
    registers: [registry]
  });

  searchLatencyHistogram = new client.Histogram({
    name: 'memory_search_seconds',
    help: 'Histogram of memory search latency (seconds)',
    labelNames: ['namespace'] as const,
    buckets: [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [registry]
  });

  // Summary provides quantiles client-side (useful for p95).
  searchLatencySummary = new client.Summary({
    name: 'memory_search_latency_summary',
    help: 'Summary of memory search latency for quantiles (p50, p90, p95)',
    labelNames: ['namespace'] as const,
    percentiles: [0.5, 0.9, 0.95],
    registers: [registry]
  });

  searchRequestsCounter = new client.Counter({
    name: 'memory_search_requests_total',
    help: 'Total memory search requests',
    labelNames: ['namespace'] as const,
    registers: [registry]
  });

  auditSignFailuresCounter = new client.Counter({
    name: 'memory_audit_sign_failures_total',
    help: 'Total audit signature failures',
    labelNames: ['reason'] as const,
    registers: [registry]
  });

  auditSignDurationHistogram = new client.Histogram({
    name: 'memory_audit_sign_seconds',
    help: 'Duration of audit signing operations',
    labelNames: ['method'] as const,
    buckets: [0.001, 0.005, 0.01, 0.02, 0.05, 0.1],
    registers: [registry]
  });

  ttlCleanerProcessedCounter = new client.Counter({
    name: 'memory_ttl_cleaner_processed_total',
    help: 'Number of TTL-cleaner processed nodes',
    labelNames: ['result'] as const,
    registers: [registry]
  });

  ttlCleanerErrorCounter = new client.Counter({
    name: 'memory_ttl_cleaner_errors_total',
    help: 'Number of TTL-cleaner errors',
    labelNames: ['error'] as const,
    registers: [registry]
  });

  piiRedactionCounter = new client.Counter({
    name: 'memory_pii_redaction_total',
    help: 'Number of responses redacted for PII',
    labelNames: ['endpoint'] as const,
    registers: [registry]
  });

  piiReadDeniedCounter = new client.Counter({
    name: 'memory_pii_read_denied_total',
    help: 'Number of attempts denied to read PII',
    labelNames: ['caller'] as const,
    registers: [registry]
  });

  // Make a final log
  console.info('[metrics] Prometheus metrics initialized and default metrics collected.');
}

/**
 * Expose /metrics handler for Express.
 * If metrics disabled, return small text response.
 */
export async function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!METRICS_ENABLED) {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.status(200).send('# metrics disabled');
    return;
  }
  try {
    const metrics = await registry.metrics();
    res.setHeader('content-type', registry.contentType);
    res.status(200).send(metrics);
  } catch (err) {
    next(err);
  }
}

/**
 * Helper functions: call these from other modules.
 * All helpers are safe no-ops if metrics disabled.
 */
export const metrics = {
  // Ingestion
  ingestion: {
    inc: (labels: { owner?: string; result?: string } = {}) => {
      if (!METRICS_ENABLED) return;
      ingestionCounter?.inc({ owner: labels.owner ?? 'unknown', result: labels.result ?? 'success' });
    }
  },

  // Memory node lifecycle
  memoryNode: {
    created: (labels: { owner?: string } = {}) => {
      if (!METRICS_ENABLED) return;
      memoryNodesCreatedCounter?.inc({ owner: labels.owner ?? 'unknown' });
    },
    deleted: (labels: { owner?: string; reason?: string } = {}) => {
      if (!METRICS_ENABLED) return;
      memoryNodesDeletedCounter?.inc({ owner: labels.owner ?? 'unknown', reason: labels.reason ?? 'ttl' });
    }
  },

  // Vector writes
  vectorWrite: {
    observe: (labels: { provider?: string; namespace?: string; owner?: string } = {}, seconds: number) => {
      if (!METRICS_ENABLED) return;
      vectorWriteHistogram?.observe({ provider: labels.provider ?? 'postgres', namespace: labels.namespace ?? 'kernel-memory', owner: labels.owner ?? 'unknown' }, seconds);
    },
    success: (labels: { provider?: string; namespace?: string } = {}) => {
      if (!METRICS_ENABLED) return;
      vectorWriteSuccessCounter?.inc({ provider: labels.provider ?? 'postgres', namespace: labels.namespace ?? 'kernel-memory' });
    },
    failure: (labels: { provider?: string; namespace?: string; error?: string } = {}) => {
      if (!METRICS_ENABLED) return;
      vectorWriteFailureCounter?.inc({ provider: labels.provider ?? 'postgres', namespace: labels.namespace ?? 'kernel-memory', error: labels.error ?? 'unknown' });
    }
  },

  // Vector queue state
  vectorQueue: {
    setDepth: (depth: number, labels: { provider?: string; namespace?: string } = {}) => {
      if (!METRICS_ENABLED) return;
      vectorQueueDepthGauge?.set({ provider: labels.provider ?? 'postgres', namespace: labels.namespace ?? 'kernel-memory' }, depth);
    },
    workerProcessed: (labels: { result?: 'completed' | 'error' } = { result: 'completed' }) => {
      if (!METRICS_ENABLED) return;
      vectorWorkerProcessedCounter?.inc({ result: labels.result ?? 'completed' });
    },
    workerError: (errLabel: string) => {
      if (!METRICS_ENABLED) return;
      vectorWorkerErrorCounter?.inc({ error: errLabel ?? 'unknown' });
    }
  },

  // Search
  search: {
    observe: (labels: { namespace?: string } = {}, seconds: number) => {
      if (!METRICS_ENABLED) return;
      searchLatencyHistogram?.observe({ namespace: labels.namespace ?? 'kernel-memory' }, seconds);
      searchLatencySummary?.observe({ namespace: labels.namespace ?? 'kernel-memory' }, seconds);
      searchRequestsCounter?.inc({ namespace: labels.namespace ?? 'kernel-memory' });
    }
  },

  // Audit signing
  audit: {
    failure: (labels: { reason?: string } = {}) => {
      if (!METRICS_ENABLED) return;
      auditSignFailuresCounter?.inc({ reason: labels.reason ?? 'unknown' });
    },
    duration: (labels: { method?: string } = {}, seconds: number) => {
      if (!METRICS_ENABLED) return;
      auditSignDurationHistogram?.observe({ method: labels.method ?? 'kms' }, seconds);
    }
  },

  // TTL cleaner
  ttlCleaner: {
    processed: (labels: { result?: string } = {}) => {
      if (!METRICS_ENABLED) return;
      ttlCleanerProcessedCounter?.inc({ result: labels.result ?? 'processed' });
    },
    error: (labels: { error?: string } = {}) => {
      if (!METRICS_ENABLED) return;
      ttlCleanerErrorCounter?.inc({ error: labels.error ?? 'unknown' });
    }
  },

  // PII redaction & access
  pii: {
    redaction: (labels: { endpoint?: string } = {}) => {
      if (!METRICS_ENABLED) return;
      piiRedactionCounter?.inc({ endpoint: labels.endpoint ?? 'unknown' });
    },
    readDenied: (labels: { caller?: string } = {}) => {
      if (!METRICS_ENABLED) return;
      piiReadDeniedCounter?.inc({ caller: labels.caller ?? 'unknown' });
    }
  },

  // Expose registry for advanced uses
  registry
};

/**
 * Convenience: returns content-type header for metrics
 */
export const metricsContentType = () => (METRICS_ENABLED ? registry.contentType : 'text/plain; charset=utf-8');

// Initialize on import if desired (but we also expose initMetrics to be explicit)
if (METRICS_ENABLED) {
  try {
    initMetrics();
  } catch (err) {
    // fail-open: log and continue (server should still start)
    // eslint-disable-next-line no-console
    console.error('[metrics] failed to initialize metrics:', (err as Error).message || err);
  }
}

export default {
  initMetrics,
  metricsMiddleware,
  metrics,
  registry,
  metricsContentType
};

