import express, { Request, Response } from 'express';
import request from 'supertest';
import idempotencyMiddleware from '../../src/middleware/idempotency';
import * as dbModule from '../../src/db';
import { MockDb } from '../utils/mockDb';

function buildApp(handler: (req: Request, res: Response) => Promise<any> | any) {
  const app = express();
  app.use(express.json());
  app.post('/test', idempotencyMiddleware, async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (err) {
      next(err);
    }
  });
  return app;
}

describe('idempotencyMiddleware', () => {
  let db: MockDb;

  beforeEach(() => {
    db = new MockDb();
    jest.spyOn(dbModule, 'getClient').mockImplementation(async () => db.createClient());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.IDEMPOTENCY_RESPONSE_BODY_LIMIT;
    delete process.env.IDEMPOTENCY_TTL_SECONDS;
  });

  test('stores response for new key', async () => {
    process.env.IDEMPOTENCY_TTL_SECONDS = '600';
    const app = buildApp(async (_req, res) => {
      return res.status(201).json({ ok: true });
    });

    const res = await request(app).post('/test').set('Idempotency-Key', 'key-1').send({ value: 1 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['idempotency-key']).toBe('key-1');

    const state = db.getState();
    const record = state.idempotency.get('key-1');
    expect(record).toBeDefined();
    expect(record?.response_status).toBe(201);
    expect(record?.response_body).toBe(JSON.stringify({ ok: true }));
    expect(record?.expires_at).toBeTruthy();
    if (record?.expires_at) {
      const created = new Date(record.created_at).getTime();
      const expires = new Date(record.expires_at).getTime();
      expect(expires - created).toBeGreaterThanOrEqual(599_000);
      expect(expires - created).toBeLessThanOrEqual(601_000);
    }
  });

  test('replays stored response on retry with same payload', async () => {
    const app = buildApp(async (_req, res) => {
      return res.json({ message: 'first' });
    });

    const first = await request(app).post('/test').set('Idempotency-Key', 'key-2').send({ payload: 1 });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ message: 'first' });

    const second = await request(app).post('/test').set('Idempotency-Key', 'key-2').send({ payload: 1 });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ message: 'first' });
    expect(second.headers['idempotency-key']).toBe('key-2');
  });

  test('rejects when response exceeds configured size limit', async () => {
    process.env.IDEMPOTENCY_RESPONSE_BODY_LIMIT = '10';
    const app = buildApp(async (_req, res) => {
      return res.json({ large: 'response-exceeds-limit' });
    });

    const res = await request(app).post('/test').set('Idempotency-Key', 'key-3').send({});

    expect(res.status).toBe(413);
    expect(res.body).toHaveProperty('error', 'idempotency_response_too_large');

    const state = db.getState();
    expect(state.idempotency.size).toBe(0);
  });

  test('returns 412 when key reused with different payload', async () => {
    const app = buildApp(async (_req, res) => {
      return res.json({ message: 'initial' });
    });

    await request(app).post('/test').set('Idempotency-Key', 'key-4').send({ payload: 'a' }).expect(200);

    const retry = await request(app).post('/test').set('Idempotency-Key', 'key-4').send({ payload: 'b' });
    expect(retry.status).toBe(412);
    expect(retry.body).toHaveProperty('error', 'idempotency_key_conflict');

    const state = db.getState();
    const record = state.idempotency.get('key-4');
    expect(record?.response_status).toBe(200);
    expect(record?.response_body).toBe(JSON.stringify({ message: 'initial' }));
  });
});
