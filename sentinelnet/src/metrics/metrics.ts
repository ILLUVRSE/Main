// sentinelnet/src/metrics/metrics.ts
/**
 * SentinelNet metrics helpers (prom-client)
 *
 * Exposes a small set of metrics and a way to register them to a provided Registry.
 * The server may choose to use its own Registry (see src/server.ts). To include
 * these metrics in the server's /metrics endpoint, call `registerMetrics(registry)`
 * during server boot.
 */

import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from 'prom-client';
import logger from '../logger';

let created = false;

let checkLatency: Histogram<string>;
let decisionsTotal: Counter<string>;
let canaryPercentGauge: Gauge<string>;

/**
 * Create metrics on a registry. Safe to call multiple times (idempotent).
 */
export function registerMetrics(registry?: Registry) {
  if (created) {
    return registry ?? (global as any).__sentinel_registry;
  }

  const r = registry ?? new Registry();

  // register default process metrics as well if using a new registry
  try {
    collectDefaultMetrics({ register: r });
  } catch (err) {
    // ignore if already registered
    logger.debug('collectDefaultMetrics failed (maybe already registered)', (err as Error).message || err);
  }

  checkLatency = new Histogram({
    name: 'sentinel_check_latency_seconds',
    help: 'Latency distribution for sentinel check API (seconds)',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10],
    registers: [r],
  });

  decisionsTotal = new Counter({
    name: 'sentinel_decisions_total',
    help: 'Total number of policy decisions by outcome',
    labelNames: ['decision'] as const,
    registers: [r],
  });

  canaryPercentGauge = new Gauge({
    name: 'sentinel_canary_percent',
    help: 'Configured canary percent per policy',
    labelNames: ['policyId'] as const,
    registers: [r],
  });

  created = true;

  // store registry for later retrieval if needed
  (global as any).__sentinel_registry = r;

  return r;
}

/**
 * Return the registry used by metrics (if any). If not registered yet, creates a fresh registry.
 */
export function getRegistry(): Registry {
  if ((global as any).__sentinel_registry) return (global as any).__sentinel_registry;
  return registerMetrics();
}

/**
 * Observe latency in seconds.
 */
export function observeCheckLatency(seconds: number) {
  if (!created) registerMetrics();
  checkLatency.observe(seconds);
}

/**
 * Increment decision counter for a decision kind: allow|deny|quarantine|remediate
 */
export function incrementDecision(decision: string) {
  if (!created) registerMetrics();
  try {
    decisionsTotal.labels(decision).inc();
  } catch (err) {
    logger.warn('incrementDecision metric failed', (err as Error).message || err);
  }
}

/**
 * Set canary percent gauge for a policy id.
 */
export function setCanaryPercent(policyId: string, percent: number) {
  if (!created) registerMetrics();
  try {
    canaryPercentGauge.labels(policyId).set(percent);
  } catch (err) {
    logger.warn('setCanaryPercent metric failed', (err as Error).message || err);
  }
}

/**
 * Convenience: return metrics exposition and content type for HTTP response.
 */
export async function metricsAsString(): Promise<{ contentType: string; body: string }> {
  const r = getRegistry();
  const ct = r.contentType;
  const body = await r.metrics();
  return { contentType: ct, body };
}

export default {
  registerMetrics,
  getRegistry,
  observeCheckLatency,
  incrementDecision,
  setCanaryPercent,
  metricsAsString,
};

