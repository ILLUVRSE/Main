import express from 'express';
import request from 'supertest';

describe('kernelRoutes RBAC enforcement (production)', () => {
  const originalEnv = process.env.NODE_ENV;
  let app: express.Express;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const { default: createKernelRouter } = await import('../../src/routes/kernelRoutes');

    app = express();
    app.use(express.json());
    app.use(createKernelRouter());
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  type HttpMethod = 'get' | 'post';

  const unauthorizedCases: Array<{ name: string; method: HttpMethod; path: string; body?: any }> = [
    { name: 'POST /kernel/create', method: 'post', path: '/kernel/create', body: {} },
    { name: 'POST /kernel/sign', method: 'post', path: '/kernel/sign', body: { manifest: { id: 'manifest-1' } } },
    { name: 'POST /kernel/division', method: 'post', path: '/kernel/division', body: { id: 'division-1' } },
    { name: 'GET /kernel/division/:id', method: 'get', path: '/kernel/division/division-1' },
    { name: 'POST /kernel/agent', method: 'post', path: '/kernel/agent', body: { id: 'agent-1', role: 'scout' } },
    { name: 'GET /kernel/agent/:id/state', method: 'get', path: '/kernel/agent/agent-1/state' },
    { name: 'POST /kernel/eval', method: 'post', path: '/kernel/eval', body: { agent_id: 'agent-1' } },
    { name: 'POST /kernel/allocate', method: 'post', path: '/kernel/allocate', body: { entity_id: 'entity-1', delta: 5 } },
    { name: 'GET /kernel/audit/:id', method: 'get', path: '/kernel/audit/audit-1' },
    { name: 'GET /kernel/reason/:node', method: 'get', path: '/kernel/reason/node-1' },
  ];

  it.each(unauthorizedCases)('%s denies anonymous access', async ({ method, path, body }) => {
    const req = request(app)[method](path);
    const res = body !== undefined ? await req.send(body) : await req;

    expect([401, 403]).toContain(res.status);
  });
});
