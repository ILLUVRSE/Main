export interface RequestObservation {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
}

interface RequestMetrics {
  count: number;
  errorCount: number;
  sum: number;
  buckets: number[];
}

interface RequestMetricEntry {
  labels: {
    method: string;
    route: string;
    statusCode: number;
  };
  metrics: RequestMetrics;
}

const HISTOGRAM_BUCKETS = [
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10,
  Number.POSITIVE_INFINITY,
];

const SUMMARY_QUANTILES = [0.5, 0.9, 0.95, 0.99];

const requestMetrics = new Map<string, RequestMetricEntry>();
let serverStartTotal = 0;
let readinessSuccessTotal = 0;
let readinessFailureTotal = 0;
let kmsProbeSuccessTotal = 0;
let kmsProbeFailureTotal = 0;

function buildRequestKey(method: string, route: string, statusCode: number): string {
  return JSON.stringify([method, route, statusCode]);
}

function getOrCreateRequestMetrics(method: string, route: string, statusCode: number): RequestMetricEntry {
  const key = buildRequestKey(method, route, statusCode);
  let entry = requestMetrics.get(key);
  if (!entry) {
    entry = {
      labels: { method, route, statusCode },
      metrics: {
        count: 0,
        errorCount: 0,
        sum: 0,
        buckets: new Array(HISTOGRAM_BUCKETS.length).fill(0),
      },
    };
    requestMetrics.set(key, entry);
  }
  return entry;
}

export function observeHttpRequest({ method, route, statusCode, durationSeconds }: RequestObservation): void {
  const { metrics } = getOrCreateRequestMetrics(method, route, statusCode);
  metrics.count += 1;
  metrics.sum += durationSeconds;

  const duration = durationSeconds < 0 ? 0 : durationSeconds;
  for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) {
    if (duration <= HISTOGRAM_BUCKETS[i]) {
      metrics.buckets[i] += 1;
      break;
    }
  }

  if (statusCode >= 500) {
    metrics.errorCount += 1;
  }
}

export function incrementServerStart(): void {
  serverStartTotal += 1;
}

export function incrementReadinessSuccess(): void {
  readinessSuccessTotal += 1;
}

export function incrementReadinessFailure(): void {
  readinessFailureTotal += 1;
}

export function incrementKmsProbeSuccess(): void {
  kmsProbeSuccessTotal += 1;
}

export function incrementKmsProbeFailure(): void {
  kmsProbeFailureTotal += 1;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\n');
}

function formatLabels(labels: Record<string, string>): string {
  const parts = Object.entries(labels).map(([key, value]) => `${key}="${escapeLabelValue(value)}"`);
  return parts.join(',');
}

function estimateQuantile(metrics: RequestMetrics, quantile: number): number {
  if (metrics.count === 0) return 0;
  const target = metrics.count * quantile;
  let cumulative = 0;
  for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) {
    cumulative += metrics.buckets[i];
    if (cumulative >= target) {
      const bucket = HISTOGRAM_BUCKETS[i];
      if (!Number.isFinite(bucket)) {
        return metrics.sum / metrics.count;
      }
      return bucket;
    }
  }
  return metrics.sum / metrics.count;
}

export function getMetrics(): string {
  const lines: string[] = [];

  lines.push('# HELP kernel_server_start_total Count of server starts');
  lines.push('# TYPE kernel_server_start_total counter');
  lines.push(`kernel_server_start_total ${serverStartTotal}`);

  lines.push('# HELP kernel_readiness_success_total Count of successful readiness probes');
  lines.push('# TYPE kernel_readiness_success_total counter');
  lines.push(`kernel_readiness_success_total ${readinessSuccessTotal}`);

  lines.push('# HELP kernel_readiness_failure_total Count of failed readiness probes');
  lines.push('# TYPE kernel_readiness_failure_total counter');
  lines.push(`kernel_readiness_failure_total ${readinessFailureTotal}`);

  lines.push('# HELP kernel_kms_probe_success_total Count of successful KMS probes');
  lines.push('# TYPE kernel_kms_probe_success_total counter');
  lines.push(`kernel_kms_probe_success_total ${kmsProbeSuccessTotal}`);

  lines.push('# HELP kernel_kms_probe_failure_total Count of failed KMS probes');
  lines.push('# TYPE kernel_kms_probe_failure_total counter');
  lines.push(`kernel_kms_probe_failure_total ${kmsProbeFailureTotal}`);

  lines.push('# HELP kernel_http_requests_total Total number of HTTP requests handled');
  lines.push('# TYPE kernel_http_requests_total counter');

  lines.push('# HELP kernel_http_request_errors_total Total number of HTTP requests resulting in error responses (status >= 500)');
  lines.push('# TYPE kernel_http_request_errors_total counter');

  lines.push('# HELP kernel_http_request_duration_seconds HTTP request duration in seconds');
  lines.push('# TYPE kernel_http_request_duration_seconds histogram');

  lines.push('# HELP kernel_http_request_duration_quantiles_seconds HTTP request duration quantiles in seconds');
  lines.push('# TYPE kernel_http_request_duration_quantiles_seconds summary');

  for (const entry of requestMetrics.values()) {
    const { labels: labelValues, metrics } = entry;
    const labels = formatLabels({
      method: labelValues.method,
      route: labelValues.route,
      status_code: String(labelValues.statusCode),
    });

    lines.push(`kernel_http_requests_total{${labels}} ${metrics.count}`);
    lines.push(`kernel_http_request_errors_total{${labels}} ${metrics.errorCount}`);

    let cumulative = 0;
    for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) {
      cumulative += metrics.buckets[i];
      const bucket = HISTOGRAM_BUCKETS[i];
      const bucketLabel = Number.isFinite(bucket) ? bucket.toString() : '+Inf';
      lines.push(`kernel_http_request_duration_seconds_bucket{${labels},le="${bucketLabel}"} ${cumulative}`);
    }
    lines.push(`kernel_http_request_duration_seconds_count{${labels}} ${metrics.count}`);
    lines.push(`kernel_http_request_duration_seconds_sum{${labels}} ${metrics.sum}`);

    for (const quantile of SUMMARY_QUANTILES) {
      const value = estimateQuantile(metrics, quantile);
      lines.push(`kernel_http_request_duration_quantiles_seconds{${labels},quantile="${quantile}"} ${value}`);
    }
    lines.push(`kernel_http_request_duration_quantiles_seconds_count{${labels}} ${metrics.count}`);
    lines.push(`kernel_http_request_duration_quantiles_seconds_sum{${labels}} ${metrics.sum}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function getMetricsContentType(): string {
  return 'text/plain; version=0.0.4';
}

export function resetMetrics(): void {
  requestMetrics.clear();
  serverStartTotal = 0;
  readinessSuccessTotal = 0;
  readinessFailureTotal = 0;
  kmsProbeSuccessTotal = 0;
  kmsProbeFailureTotal = 0;
}

