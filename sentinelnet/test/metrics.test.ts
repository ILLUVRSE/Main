import metrics from '../src/metrics/metrics';

describe('metrics registry', () => {
  test('exposes required sentinel metrics', async () => {
    const { body } = await metrics.metricsAsString();
    expect(body).toContain('sentinel_check_latency_seconds');
    expect(body).toContain('sentinel_decisions_total');
    expect(body).toContain('sentinel_canary_percent');
  });
});
