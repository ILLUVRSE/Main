import express from 'express';
import request from '../utils/mockSupertest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import createKernelRouter, { IdempotencyRecord, IdempotencyStore } from '../../src/api/kernels/handler';
import { resetAuthCaches } from '../../src/middleware/auth';

class MemoryIdempotencyStore implements IdempotencyStore {
  private records = new Map<string, IdempotencyRecord>();

  async get(key: string): Promise<IdempotencyRecord | null> {
    return this.records.get(key) ?? null;
  }

  async save(record: IdempotencyRecord): Promise<void> {
    const clone = JSON.parse(JSON.stringify(record));
    this.records.set(record.key, clone);
  }
}

describe('POST /kernel/create', () => {
  let privateKey: any;
  let publicJwk: any;
  const issuer = 'https://issuer.example.com';
  const audience = 'kernel-api';

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    publicJwk.kid = 'integration-key';
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

  function buildApp(store?: IdempotencyStore) {
    const app = express();
    app.use(express.json());
    app.use(createKernelRouter({ idempotencyStore: store ?? new MemoryIdempotencyStore() }));
    return app;
  }

  async function signToken(roles: string[], subject = 'user-1') {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ roles })
      .setProtectedHeader({ alg: 'RS256', kid: 'integration-key' })
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .sign(privateKey);
  }

  test('returns 401 when unauthenticated', async () => {
    const app = buildApp();
    const res = await request(app).post('/kernel/create').send({ name: 'kernel' });
    expect(res.status).toBe(401);
  });

  test('returns 403 when authenticated without required role', async () => {
    const app = buildApp();
    const token = await signToken(['Auditor']);
    const res = await request(app)
      .post('/kernel/create')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'abc-123')
      .send({ name: 'kernel' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error', 'forbidden');
  });

  test('returns 200 and replays response on idempotent call', async () => {
    const store = new MemoryIdempotencyStore();
    const app = buildApp(store);
    const token = await signToken(['Operator']);

    const res1 = await request(app)
      .post('/kernel/create')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'key-1')
      .send({ name: 'kernel' });

    expect(res1.status).toBe(200);
    expect(res1.body).toHaveProperty('kernelId');
    const firstId = res1.body.kernelId;

    const res2 = await request(app)
      .post('/kernel/create')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'key-1')
      .send({ name: 'kernel again' });

    expect(res2.status).toBe(200);
    expect(res2.body.kernelId).toBe(firstId);
  });
});
