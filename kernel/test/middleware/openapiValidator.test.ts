import request from 'supertest';
import { createApp, createAppSync } from '../utils/testApp';

let serverForTests: any;
let createdServer = false;

async function normalizeToServer(appOrFactory: any): Promise<{ server: any; created: boolean }> {
  if (!appOrFactory) throw new Error('no app');
  if (typeof appOrFactory.address === 'function') return { server: appOrFactory, created: false };
  if (typeof appOrFactory === 'function' && (appOrFactory.use || appOrFactory.handle)) {
    const s = appOrFactory.listen(0);
    return { server: s, created: true };
  }
  if (appOrFactory && typeof appOrFactory.app === 'function' && (appOrFactory.app.use || appOrFactory.app.handle)) {
    const s = appOrFactory.app.listen(0);
    return { server: s, created: true };
  }
  if (typeof appOrFactory === 'function') {
    const maybe = appOrFactory();
    const resolved = (maybe && typeof maybe.then === 'function') ? await maybe : maybe;
    return normalizeToServer(resolved);
  }
  throw new Error('normalizeToServer: unsupported shape');
}

beforeAll(async () => {
  let raw: any;
  try {
    raw = createAppSync();
  } catch (e) {
    // ignore
  }
  if (!raw) raw = await createApp();
  const n = await normalizeToServer(raw);
  serverForTests = n.server;
  createdServer = n.created;
});

afterAll(async () => {
  if (createdServer && serverForTests && typeof serverForTests.close === 'function') {
    await new Promise<void>((resolve) => serverForTests.close(() => resolve()));
  }
});

describe('OpenAPI validation middleware', () => {
  test('rejects invalid division manifest payloads', async () => {
    const res = await request(serverForTests)
      .post('/kernel/division')
      .set('Accept', 'application/json')
      .send({ name: 12345 /* invalid type */ });
    expect([400, 422]).toContain(res.status);
    expect(res.body).toBeDefined();
  });
});

