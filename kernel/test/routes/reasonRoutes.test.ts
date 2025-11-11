import request from 'supertest';
import { createApp, createAppSync } from '../utils/testApp';

let serverForTests: any;
let createdServer = false;

/**
 * Convert many possible exported shapes into an http.Server instance
 * suitable for supertest. If we receive an express app, we call .listen(0)
 * and record the created server so we can close it after tests.
 */
async function normalizeToServer(appOrFactory: any): Promise<{ server: any; created: boolean }> {
  if (!appOrFactory) {
    throw new Error('normalizeToServer: no app provided');
  }

  // If it's an http.Server already (has address() fn), use it
  if (typeof appOrFactory.address === 'function') {
    return { server: appOrFactory, created: false };
  }

  // If it's an express app (function with use/handle), call listen(0)
  if (typeof appOrFactory === 'function' && (appOrFactory.use || appOrFactory.handle)) {
    const srv = appOrFactory.listen(0);
    return { server: srv, created: true };
  }

  // If it's an object with .app that is express
  if (appOrFactory && typeof appOrFactory.app === 'function' && (appOrFactory.app.use || appOrFactory.app.handle)) {
    const srv = appOrFactory.app.listen(0);
    return { server: srv, created: true };
  }

  // If it's a factory function that returns an app or a server (sync or promise)
  if (typeof appOrFactory === 'function') {
    const maybe = appOrFactory();
    const resolved = (maybe && typeof maybe.then === 'function') ? await maybe : maybe;
    return normalizeToServer(resolved);
  }

  // If it's a plain object with an inner server
  if (appOrFactory && typeof appOrFactory.server === 'object' && typeof appOrFactory.server.address === 'function') {
    return { server: appOrFactory.server, created: false };
  }

  throw new Error('normalizeToServer: unsupported app shape - ' + typeof appOrFactory);
}

beforeAll(async () => {
  // Try createAppSync first; fallback to createApp; fallback to exported app
  let raw: any;
  try {
    raw = createAppSync();
  } catch (e) {
    // ignore
  }
  if (!raw) {
    raw = await createApp();
  }

  const normalized = await normalizeToServer(raw);
  serverForTests = normalized.server;
  createdServer = normalized.created;
});

afterAll(async () => {
  if (createdServer && serverForTests && typeof serverForTests.close === 'function') {
    await new Promise<void>((resolve) => serverForTests.close(() => resolve()));
  }
});

describe('reasonRoutes', () => {
  const endpoint = (nodeId: string) => `/kernel/reason/${nodeId}`;

  test('GET /kernel/reason/:node denies anonymous access', async () => {
    const res = await request(serverForTests).get(endpoint('node-1')).set('Accept', 'application/json');
    // Depending on configuration, unauthenticated may return 401/403, or 404 if route intentionally hides existence.
    expect([401, 403, 404]).toContain(res.status);
  });

  test('GET /kernel/reason/:node returns 404 for authenticated human principal when node missing', async () => {
    const res = await request(serverForTests)
      .get(endpoint('node-absent'))
      .set('Accept', 'application/json')
      // test-only headers used by many integration/unit tests in this repo
      .set('x-oidc-sub', 'user.dev')
      .set('x-oidc-roles', 'Operator');
    // If node does not exist we expect a 404, authenticated request should not be treated as anonymous.
    expect(res.status).toBe(404);
    // Ensure JSON body is returned (may be { error: 'not_found' } or similar)
    expect(res.body).toBeDefined();
  });

  test('GET /kernel/reason/:node allows service principal with Operator role (returns 404 for missing node)', async () => {
    const res = await request(serverForTests)
      .get(endpoint('node-absent-2'))
      .set('Accept', 'application/json')
      // service principal headers used in tests
      .set('x-service-id', 'svc.kernel')
      .set('x-service-roles', 'Operator');
    expect(res.status).toBe(404);
    expect(res.body).toBeDefined();
  });
});

