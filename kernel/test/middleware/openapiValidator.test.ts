import request from 'supertest';
import { createApp } from '../../src/server';

describe('OpenAPI validation middleware', () => {
  let app: any;

  beforeAll(async () => {
    app = await createApp();
  });

  test('rejects invalid division manifest payloads', async () => {
    const res = await request(app)
      .post('/kernel/division')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'validator-test-1')
      .send({
        id: 'division-1',
        name: 'Alpha Division',
        goals: 'not-an-array',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'validation_error');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: 'body',
        }),
      ]),
    );
  });
});
