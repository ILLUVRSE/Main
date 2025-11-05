// kernel/test/integration/rbac.integration.test.ts
import request from 'supertest';
import { createApp } from '../../src/server';
import { Roles } from '../../src/rbac';

jest.setTimeout(60_000);

describe('RBAC integration (test-only endpoints)', () => {
  let app: any;

  beforeAll(async () => {
    // createApp returns an Express app instance (does not start a network server)
    app = await createApp();
  });

  test('GET /principal returns the principal computed from x-oidc headers', async () => {
    const res = await request(app)
      .get('/principal')
      .set('x-oidc-sub', 'itest-user')
      .set('x-oidc-roles', 'Operator,division-lead');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('principal');
    const p = res.body.principal;
    expect(p).toMatchObject({ type: 'human', id: 'itest-user' });
    // Roles are parsed from header and preserved; ensure both tokens present
    expect(Array.isArray(p.roles)).toBe(true);
    expect(p.roles).toEqual(expect.arrayContaining(['Operator', 'division-lead']));
  });

  test('GET /require-roles allows access when caller has Operator role', async () => {
    const res = await request(app)
      .get('/require-roles')
      .set('x-oidc-sub', 'user-op')
      .set('x-oidc-roles', 'Operator');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('principal');
    expect(res.body.principal).toMatchObject({ type: 'human', id: 'user-op' });
  });

  test('GET /require-any allows service principal with Operator role', async () => {
    const res = await request(app)
      .get('/require-any')
      .set('x-service-id', 'svc-abc')
      .set('x-service-roles', 'Operator');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('principal');
    expect(res.body.principal).toMatchObject({ type: 'service', id: 'svc-abc' });
    expect(res.body.principal.roles).toEqual(expect.arrayContaining([Roles.OPERATOR]));
  });

  test('GET /require-roles returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/require-roles');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'unauthenticated');
  });

  test('GET /require-roles returns 403 when authenticated but lacks role', async () => {
    const res = await request(app)
      .get('/require-roles')
      .set('x-oidc-sub', 'user-no-role')
      .set('x-oidc-roles', 'Auditor'); // not in [SuperAdmin, Operator]

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error', 'forbidden');
    expect(res.body).toHaveProperty('required');
  });
});

