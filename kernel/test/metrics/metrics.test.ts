import { resetMetrics, observeHttpRequest, getMetrics, getMetricsContentType } from '../../src/metrics/prometheus';

describe('Prometheus metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('records HTTP metrics with per-endpoint labels', () => {
    observeHttpRequest({
      method: 'GET',
      route: '/health',
      statusCode: 200,
      durationSeconds: 0.05,
    });
    observeHttpRequest({
      method: 'GET',
      route: '/health',
      statusCode: 200,
      durationSeconds: 0.01,
    });

    const contentType = getMetricsContentType();
    expect(contentType).toContain('text/plain');

    const body = getMetrics();
    expect(body).toContain('kernel_http_requests_total');
    expect(body).toMatch(new RegExp('kernel_http_requests_total\\{[^}]*route="\\/health"[^}]*status_code="200"'));
    expect(body).toContain('kernel_http_request_duration_seconds_bucket');
    expect(body).toMatch(new RegExp('kernel_http_request_duration_quantiles_seconds\\{[^}]*quantile="0.95"'));
  });
});
