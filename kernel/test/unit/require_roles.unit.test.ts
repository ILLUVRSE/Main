// kernel/test/unit/require_roles.unit.test.ts
import express from 'express';
import request from 'supertest';
import { requireRoles, Roles } from '../../src/rbac';

describe('requireRoles middleware', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Protected endpoint for tests
    app.get(
      '/protected',
      requireRoles(Roles.SUPERADMIN, Roles.OPERATOR),
      (req, res) => {
        // Echo principal for assertions
        return res.json({ ok: true, principal: (req as any).principal });
      }
    );
  });

  test('returns 401 when no principal / unauthenticated', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'unauthenticated');
  });

  test('returns 403 when principal lacks required roles', async () => {
    const res = await request(app)
      .get('/protected')
      .set('x-oidc-sub', 'user-1')
      .set('x-oidc-roles', 'Auditor'); // Auditor is not in [SuperAdmin, Operator]

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error', 'forbidden');
    // optional: ensure required field is included
    expect(res.body).toHaveProperty('required');
    expect(Array.isArray(res.body.required)).toBe(true);
  });

  test('allows access when human principal has one of required roles', async () => {
    const res = await request(app)
      .get('/protected')
      .set('x-oidc-sub', 'user-2')
      .set('x-oidc-roles', 'Operator'); // Operator is allowed

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('principal');
    expect(res.body.principal).toMatchObject({ type: 'human', id: 'user-2' });
    expect(Array.isArray(res.body.principal.roles)).toBe(true);
    expect(res.body.principal.roles).toEqual(expect.arrayContaining([Roles.OPERATOR]));
  });

  test('allows access when service principal has one of required roles', async () => {
    const res = await request(app)
      .get('/protected')
      .set('x-service-id', 'svc-1')
      .set('x-service-roles', 'Operator'); // service role header

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body.principal).toMatchObject({ type: 'service', id: 'svc-1' });
    expect(res.body.principal.roles).toEqual(expect.arrayContaining([Roles.OPERATOR]));
  });

  test('attaches req.principal for downstream handlers', async () => {
    const res = await request(app)
      .get('/protected')
      .set('x-oidc-sub', 'user-3')
      .set('x-oidc-roles', 'SuperAdmin');

    expect(res.status).toBe(200);
    expect(res.body.principal).toBeDefined();
    expect(res.body.principal.id).toBe('user-3');
    expect(Array.isArray(res.body.principal.roles)).toBe(true);
    expect(res.body.principal.roles).toEqual(expect.arrayContaining([Roles.SUPERADMIN]));
  });
});

