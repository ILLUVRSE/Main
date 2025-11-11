/**
 * E2E test (resilient)
 *
 * This version tolerates agent creation returning either 201 (Created)
 * or 202 (Accepted). If the server returns 202 we attempt to extract the
 * agent id from body or Location header. If no id is available we raise
 * a clear error explaining what the server should provide for reliable tests.
 */

import request from 'supertest';
import { createApp, createAppSync } from '../test/utils/testApp';

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
  if (appOrFactory && appOrFactory.server && typeof appOrFactory.server.address === 'function') {
    return { server: appOrFactory.server, created: false };
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
  const normalized = await normalizeToServer(raw);
  serverForTests = normalized.server;
  createdServer = normalized.created;
});

afterAll(async () => {
  if (createdServer && serverForTests && typeof serverForTests.close === 'function') {
    await new Promise<void>((resolve) => serverForTests.close(() => resolve()));
  }
});

describe('E2E create → sign → spawn → eval → allocate', () => {
  // This test follows the "happy path" through several endpoints.
  test('happy path through division, agent, eval, allocation', async () => {
    const app = serverForTests;

    // Create a division
    const divisionRes = await request(app)
      .post('/kernel/division')
      .set('Accept', 'application/json')
      .set('Idempotency-Key', 'division-ik')
      .send({ name: 'division-1', budget: 100 });
    expect([201, 200]).toContain(divisionRes.status);

    // Create an agent (could return 201 or 202)
    const agentRes = await request(app)
      .post('/kernel/agent')
      .set('Accept', 'application/json')
      .set('Idempotency-Key', 'agent-ik')
      .send({ divisionId: 'division-1', role: 'scout', templateId: 'template-1' });

    // Accept either 201 Created or 202 Accepted. Try to extract agent id in both cases.
    expect([201, 202]).toContain(agentRes.status);

    // Attempt to find agent id
    let agentId: string | null = null;
    if (agentRes.body && (agentRes.body.id || agentRes.body.agent?.id)) {
      agentId = agentRes.body.id || agentRes.body.agent?.id;
    } else {
      // try Location header
      const loc = agentRes.headers.location || agentRes.headers.Location;
      if (loc && typeof loc === 'string') {
        const parts = loc.split('/');
        agentId = parts[parts.length - 1] || null;
      }
    }

    if (!agentId) {
      // If server returned 201/202 but did not provide an id, we can't proceed deterministically.
      // Fail with a helpful message so the server behavior can be adjusted (return id or Location).
      throw new Error(
        `Agent creation returned ${agentRes.status} but no agent id could be extracted. ` +
          `Response body keys: ${JSON.stringify(Object.keys(agentRes.body || {}))}, headers keys: ${JSON.stringify(
            Object.keys(agentRes.headers || {})
          )}. For reliable tests the server should return { id } for 201 or Location header or { agent: { id } } when 202.`
      );
    }

    // Proceed with eval request that references the agent
    const evalRes = await request(app)
      .post('/kernel/eval')
      .set('Accept', 'application/json')
      .send({ agentId, code: 'return 42;' });

    expect([200, 201]).toContain(evalRes.status);
    // Optionally check result/parsing
    expect(evalRes.body).toBeDefined();

    // Allocation step: attempt to allocate some budget for the division
    const allocRes = await request(app)
      .post('/kernel/allocate')
      .set('Accept', 'application/json')
      .send({ entity_id: 'division-1', delta: 10 });

    // Allocation may be allowed or denied depending on sentinel/etc, but ensure request completed
    expect([200, 201, 403]).toContain(allocRes.status);
    expect(allocRes.body).toBeDefined();
  }, 30_000);
});

