import request from 'supertest';
import { createApp } from '../../src/server';
import { resetMetrics } from '../../src/metrics/prometheus';

describe('Prometheus metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('scrapes HTTP metrics with per-endpoint labels', async () => {
    const app = await createApp();

    await request(app).get('/health').expect(200);

    const res = await request(app).get('/metrics').expect(200);

    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('kernel_http_requests_total');
    expect(res.text).toMatch(new RegExp('kernel_http_requests_total\\{[^}]*route="\\/health"[^}]*status_code="200"'));
    expect(res.text).toContain('kernel_http_request_duration_seconds_bucket');
    expect(res.text).toMatch(
      new RegExp('kernel_http_request_duration_quantiles_seconds\\{[^}]*quantile="0.95"'),
    );
  });
});

