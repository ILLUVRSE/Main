import client from 'prom-client';

const registry = new client.Registry();
const prefix = process.env.METRICS_PREFIX || 'marketplace_';

client.collectDefaultMetrics({
  register: registry,
  prefix,
});

export const checkoutAttemptsTotal = new client.Counter({
  name: `${prefix}checkout_attempts_total`,
  help: 'Number of checkout attempts received',
});

export const checkoutFailuresTotal = new client.Counter({
  name: `${prefix}checkout_failures_total`,
  help: 'Checkout attempts that resulted in errors',
});

export const checkoutSettlementDuration = new client.Histogram({
  name: `${prefix}settlement_latency_seconds`,
  help: 'Latency from payment webhook receipt to settlement/finalization',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
});

export const deliveryModeCounter = new client.Counter({
  name: `${prefix}delivery_mode_total`,
  help: 'Count of deliveries per encryption mode',
  labelNames: ['mode'],
});

registry.registerMetric(checkoutAttemptsTotal);
registry.registerMetric(checkoutFailuresTotal);
registry.registerMetric(checkoutSettlementDuration);
registry.registerMetric(deliveryModeCounter);

export function getMetricsRegistry() {
  return registry;
}

export default {
  registry,
  checkoutAttemptsTotal,
  checkoutFailuresTotal,
  checkoutSettlementDuration,
  deliveryModeCounter,
};
