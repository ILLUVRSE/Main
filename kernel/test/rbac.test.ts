// kernel/test/rbac.test.ts
import request from 'supertest';
import { createTestApp } from './utils/testApp';
import { hasAnyRole, hasRole, Roles, Principal } from '../src/rbac';

describe('RBAC unit tests', () => {
  let app: any;

  beforeAll(async () => {
    app = await createTestApp();
  });

  describe('getPrincipalFromRequest via /principal', () => {
    test('returns human principal for x-oidc-sub + x-oidc-roles', async () => {
      const res = await request(app)
        .get('/principal')
        .set('x-oidc-sub', 'user-123')
        .set('x-oidc-roles', 'SuperAdmin,Operator');

      expect(res.status).toBe(200);
      const p = res.body?.principal;
      expect(p).toBeDefined();
      expect(p.type).toBe('human');
      expect(p.id).toBe('user-123');
      expect(Array.isArray(p.roles)).toBe(true);
      expect(p.roles).toEqual(expect.arrayContaining([Roles.SUPERADMIN, Roles.OPERATOR]));
    });

    test('returns service principal for x-service-id + x-service-roles', async () => {
      const res = await request(app)
        .get('/principal')
        .set('x-service-id', 'svc-abc')
        .set('x-service-roles', 'Operator');

      expect(res.status).toBe(200);
      const p = res.body?.principal;
      expect(p).toBeDefined();
      expect(p.type).toBe('service');
      expect(p.id).toBe('svc-abc');
      expect(p.roles).toEqual(expect.arrayContaining(['Operator']));
    });

    test('role override header returns dev-override principal', async () => {
      const res = await request(app)
        .get('/principal')
        .set('x-role-override', 'Auditor Operator');

      expect(res.status).toBe(200);
      const p = res.body?.principal;
      expect(p).toBeDefined();
      expect(p.type).toBe('human');
      expect(p.id).toBe('dev-override');
      expect(p.roles).toEqual(expect.arrayContaining(['Auditor', 'Operator']));
    });
  });

  describe('requireAnyAuthenticated', () => {
    test('allows human principal', async () => {
      const res = await request(app)
        .get('/require-any')
        .set('x-oidc-sub', 'human-1')
        .set('x-oidc-roles', 'Operator');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body).toHaveProperty('principal');
      expect(res.body.principal.type).toBe('human');
    });

    test('allows service principal', async () => {
      const res = await request(app)
        .get('/require-any')
        .set('x-service-id', 'svc-1')
        .set('x-service-roles', 'Operator');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.principal.type).toBe('service');
    });

    test('returns 401 for anonymous', async () => {
      const res = await request(app).get('/require-any');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'unauthenticated');
    });
  });

  describe('requireRoles middleware (SuperAdmin OR Operator)', () => {
    test('401 when anonymous', async () => {
      const res = await request(app).get('/require-roles');
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'unauthenticated');
      expect(Array.isArray(res.body.requiredRoles)).toBe(true);
    });

    test('403 when authenticated but lacks required roles', async () => {
      const res = await request(app)
        .get('/require-roles')
        .set('x-oidc-sub', 'user-456')
        .set('x-oidc-roles', 'Auditor');

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error', 'forbidden');
      expect(res.body).toHaveProperty('requiredRoles');
      expect(Array.isArray(res.body.requiredRoles)).toBe(true);
      expect(res.body).toHaveProperty('required');
      expect(Array.isArray(res.body.required)).toBe(true);
    });

    test('200 and principal attached when role present (Operator)', async () => {
      const res = await request(app)
        .get('/require-roles')
        .set('x-oidc-sub', 'user-789')
        .set('x-oidc-roles', 'Operator,Auditor');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ok', true);
      expect(res.body.principal).toBeDefined();
      expect(res.body.principal.roles).toEqual(expect.arrayContaining([Roles.OPERATOR]));
    });

    test('200 when SuperAdmin present', async () => {
      const res = await request(app)
        .get('/require-roles')
        .set('x-oidc-sub', 'super-1')
        .set('x-oidc-roles', 'SuperAdmin');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.principal.roles).toEqual(expect.arrayContaining([Roles.SUPERADMIN]));
    });
  });

  describe('hasAnyRole helper', () => {
    test('returns true when principal has at least one required role', () => {
      const principal: Principal = { type: 'human', id: 'p1', roles: ['Operator'] };
      expect(hasAnyRole(principal, ['Operator', 'Auditor'])).toBe(true);
    });

    test('returns false when principal lacks required roles', () => {
      const principal: Principal = { type: 'human', id: 'p2', roles: ['Auditor'] };
      expect(hasAnyRole(principal, 'Operator')).toBe(false);
    });

    test('handles space/comma separated parsing indirectly via headers (integration)', async () => {
      // Verify "Admin,Operator" header results in Operator being present
      const res = await request(app)
        .get('/principal')
        .set('x-oidc-sub', 'user-parse')
        .set('x-oidc-roles', 'Admin,Operator');

      const p = res.body.principal;
      expect(p.roles).toEqual(expect.arrayContaining(['Operator']));
    });
  });

  describe('hasRole helper', () => {
    test('matches case-insensitively when role present', () => {
      const principal: Principal = { type: 'human', id: 'user', roles: ['Operator'] };
      expect(hasRole(principal, 'operator')).toBe(true);
    });

    test('returns false when principal missing role', () => {
      const principal: Principal = { type: 'human', id: 'user', roles: ['Auditor'] };
      expect(hasRole(principal, Roles.SUPERADMIN)).toBe(false);
    });

    test('returns false when user undefined', () => {
      expect(hasRole(undefined as unknown as Principal, Roles.OPERATOR)).toBe(false);
    });

    test('returns false when roles is not an array', () => {
      const malformed: any = { type: 'human', id: 'abc', roles: 'Operator' };
      expect(hasRole(malformed, Roles.OPERATOR)).toBe(false);
    });
  });
});
