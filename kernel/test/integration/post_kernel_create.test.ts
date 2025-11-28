import express from 'express';
import request from '../utils/mockSupertest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { resetAuthCaches } from '../../src/middleware/auth';

const ORIGINAL_ENV = process.env.NODE_ENV;
const issuer = 'https://post-kernel-create.test';
const audience = 'kernel-api';
let privateKey: any;
let publicJwk: any;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  publicJwk.kid = 'post-kernel-create';
});

beforeEach(() => {
  process.env.KERNEL_OIDC_CONFIG_JSON = JSON.stringify({
    issuer,
    audience,
    jwks: { keys: [publicJwk] },
  });
  resetAuthCaches();
});

afterEach(() => {
  delete process.env.KERNEL_OIDC_CONFIG_JSON;
  resetAuthCaches();
});

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

async function signToken(roles: string[], subject = 'user-1') {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ roles })
    .setProtectedHeader({ alg: 'RS256', kid: 'post-kernel-create' })
    .setIssuedAt(now)
    .setExpirationTime(now + 600)
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .sign(privateKey);
}

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
    const forbiddenToken = await signToken(['Viewer']);
    const res = await request(app)
      .post('/kernel/create')
      .set('Idempotency-Key', 'forbidden-key')
      .set('Authorization', `Bearer ${forbiddenToken}`)
      .send({ name: 'example' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error', 'forbidden');
  });

  test('returns 201 for first call and 200 for idempotent replay', async () => {
    const app = await buildApp();
    const idempotencyKey = 'create-key-1';
    const operatorToken = await signToken(['Operator'], 'operator-user');

    const res1 = await request(app)
      .post('/kernel/create')
      .set('Idempotency-Key', idempotencyKey)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Kernel Alpha' });

    expect(res1.status).toBe(201);
    expect(res1.body).toHaveProperty('kernelId');
    const firstKernelId = res1.body.kernelId;

    const res2 = await request(app)
      .post('/kernel/create')
      .set('Idempotency-Key', idempotencyKey)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Kernel Beta' });

    expect(res2.status).toBe(200);
    expect(res2.body.kernelId).toBe(firstKernelId);
    expect(res2.body.name).toBe('Kernel Alpha');
  });
});
