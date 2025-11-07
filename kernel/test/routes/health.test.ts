// kernel/test/routes/health.test.ts
import request from 'supertest';
import { createApp } from '../../src/server';
import * as healthModule from '../../src/routes/health';

describe('health routes', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('GET /health returns enriched payload', async () => {
    jest.spyOn(healthModule, 'probeDatabase').mockResolvedValue(true);
    jest.spyOn(healthModule, 'probeKms').mockResolvedValue(false);

    const app = await createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      db_reachable: true,
      kms_reachable: false,
      signer_id: expect.any(String),
      app_version: expect.any(String),
      slo: {
        availability_target: expect.any(String),
        latency_p99_ms: expect.any(Number),
        rto_seconds: expect.any(Number),
      },
    });
    expect(typeof res.body.timestamp).toBe('string');
  });

  test('GET /ready returns 503 when DB is unavailable', async () => {
    jest.spyOn(healthModule, 'probeDatabase').mockResolvedValue(false);
    jest.spyOn(healthModule, 'probeKms').mockResolvedValue(false);

    const app = await createApp();
    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'not_ready', details: 'db.unreachable' });
  });
});

