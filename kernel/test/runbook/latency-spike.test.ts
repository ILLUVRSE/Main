
import { describe, it, expect } from 'vitest';
import { observeHttpRequest, getMetrics, resetMetrics } from '../../src/metrics/prometheus';

describe('Runbook Simulation: Latency Spike', () => {
  it('should reflect high latency in histograms', async () => {
    resetMetrics();

    // Simulate high latency requests
    for (let i = 0; i < 100; i++) {
        // 80 requests at 100ms
        // 20 requests at 600ms (breach p99 500ms)
        const duration = i < 80 ? 0.1 : 0.6;
        observeHttpRequest({
            method: 'POST',
            route: '/kernel/sign',
            statusCode: 200,
            durationSeconds: duration
        });
    }

    const metrics = getMetrics();
    // Check bucket counts
    // 0.5s bucket should have 80
    // +Inf should have 100
    // So 20 are > 0.5s

    // The metric format in getMetrics() output:
    // kernel_http_request_duration_seconds_bucket{...,le="0.5"} 80
    // kernel_http_request_duration_seconds_bucket{...,le="+Inf"} 100

    expect(metrics).toMatch(/kernel_http_request_duration_seconds_bucket{.*le="0.5"} 80/);
    expect(metrics).toMatch(/kernel_http_request_duration_seconds_bucket{.*le="\+Inf"} 100/);
  });
});
