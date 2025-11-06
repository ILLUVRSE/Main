import express from 'express';
import request from 'supertest';

const ORIGINAL_ENV = process.env.NODE_ENV;

async function buildApp() {
  jest.resetModules();
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  const { resetKernelCreateStore } = await import('../../src/handlers/kernelCreate');
  resetKernelCreateStore();
  const { default: createKernelRouter } = await import('../../src/routes/kernelRoutes');

  process.env.NODE_ENV = previousEnv;

  const app = express();
  app.use(express.json());
  app.use(createKernelRouter());
  return app;
}

afterAll(() => {
  process.env.NODE_ENV = ORIGINAL_ENV;
});

describe('POST /kernel/create', () => {
  test('returns 401 when unauthenticated', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/kernel/create')
      .set('Idempotency-Key', 'unauth-key')
      .send({ name: 'example' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'unauthenticated');
  });

  test('returns 403 when authenticated without required role', async () => {
    const app = await buildApp();
    const res = await request(app)
      .post('/kernel/create')
      .set('Idempotency-Key', 'forbidden-key')
      .set('x-oidc-sub', 'user-123')
      .set('x-oidc-roles', 'Viewer')
      .send({ name: 'example' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error', 'forbidden');
  });

  test('returns 201 for first call and 200 for idempotent replay', async () => {
    const app = await buildApp();
    const idempotencyKey = 'create-key-1';

    const res1 = await request(app)
      .post('/kernel/create')
      .set('Idempotency-Key', idempotencyKey)
      .set('x-oidc-sub', 'operator-user')
      .set('x-oidc-roles', 'Operator')
      .send({ name: 'Kernel Alpha' });

    expect(res1.status).toBe(201);
    expect(res1.body).toHaveProperty('kernelId');
    const firstKernelId = res1.body.kernelId;

    const res2 = await request(app)
      .post('/kernel/create')
      .set('Idempotency-Key', idempotencyKey)
      .set('x-oidc-sub', 'operator-user')
      .set('x-oidc-roles', 'Operator')
      .send({ name: 'Kernel Beta' });

    expect(res2.status).toBe(200);
    expect(res2.body.kernelId).toBe(firstKernelId);
    expect(res2.body.name).toBe('Kernel Alpha');
  });
});
