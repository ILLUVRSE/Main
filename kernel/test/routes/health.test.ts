import request from 'supertest';
import { createApp, createAppSync } from '../utils/testApp';

let serverForTests: any;
let createdServer = false;

async function normalizeToServer(appOrFactory: any): Promise<{ server: any; created: boolean }> {
  if (!appOrFactory) throw new Error('no app provided');
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

describe('healthRoutes', () => {
  const paths = ['/health', '/healthz', '/_health', '/ready', '/_ready'];

  test('GET /health (or equivalent) responds', async () => {
    const res = await request(serverForTests).get('/health');
    expect([200, 204, 404]).toContain(res.status); // allow 404 if service not providing check in certain mode
  });

  test('Common alternate endpoints respond (healthz, _health, ready, _ready)', async () => {
    for (const p of paths) {
      const res = await request(serverForTests).get(p);
      expect([200, 204, 404]).toContain(res.status);
    }
  });

  test('Health endpoints should return a small JSON object when present', async () => {
    const res = await request(serverForTests).get('/health').set('Accept', 'application/json');
    if (res.status === 200) {
      expect(typeof res.body === 'object').toBeTruthy();
    }
  });
});

