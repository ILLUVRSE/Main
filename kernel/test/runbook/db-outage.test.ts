
import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../../src/server';
import request from 'supertest';
import * as db from '../../src/db';
import { getMetrics } from '../../src/metrics/prometheus';

describe('Runbook Simulation: DB Outage', () => {
  it('should report readiness failure when DB is down', async () => {
    // Mock waitForDb to throw
    vi.spyOn(db, 'waitForDb').mockRejectedValue(new Error('DB Down'));

    const app = await createApp();

    // Check readiness
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.details).toBe('db.unreachable');

    // Check metrics
    const metrics = await request(app).get('/metrics');
    expect(metrics.text).toContain('kernel_readiness_failure_total');
  });
});
