// kernel/test/rbac.test.ts
import { Request, Response } from 'express';
import {
  getPrincipalFromRequest,
  requireAnyAuthenticated,
  requireRoles,
  hasAnyRole,
  hasRole,
  Roles,
  Principal,
} from '../src/rbac';

function makeReq(headers: Record<string, string> = {}): Request {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalized[k.toLowerCase()] = v;
  }
  const req: any = {
    method: 'GET',
    path: '/test',
    header(name: string) {
      if (name.toLowerCase() === 'set-cookie') return undefined;
      return normalized[name.toLowerCase()];
    },
    get(name: string) {
      if (name.toLowerCase() === 'set-cookie') return undefined;
      return normalized[name.toLowerCase()];
    },
  };
  return req as Request;
}

function makeRes(): Response & { body: any } {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    setHeader(key: string, value: string) {
      this.headers[key.toLowerCase()] = value;
      return this;
    },
  };
  return res as Response & { body: any };
}

describe('RBAC unit tests', () => {
  describe('getPrincipalFromRequest', () => {
    test('returns human principal for x-oidc headers', () => {
      const req = makeReq({ 'x-oidc-sub': 'user-123', 'x-oidc-roles': 'SuperAdmin,Operator' });
      const principal = getPrincipalFromRequest(req);
      expect(principal.type).toBe('human');
      expect(principal.id).toBe('user-123');
      expect(principal.roles).toEqual(expect.arrayContaining([Roles.SUPERADMIN, Roles.OPERATOR]));
    });

    test('returns service principal for service headers', () => {
      const req = makeReq({ 'x-service-id': 'svc-abc', 'x-service-roles': 'Operator' });
      const principal = getPrincipalFromRequest(req);
      expect(principal.type).toBe('service');
      expect(principal.id).toBe('svc-abc');
      expect(principal.roles).toEqual(expect.arrayContaining(['Operator']));
    });

    test('role override header returns dev principal', () => {
      const req = makeReq({ 'x-role-override': 'Auditor Operator' });
      const principal = getPrincipalFromRequest(req);
      expect(principal.id).toBe('dev-override');
      expect(principal.roles).toEqual(expect.arrayContaining(['Auditor', 'Operator']));
    });
  });

  describe('requireAnyAuthenticated middleware', () => {
    test('allows human principal', (done) => {
      const req = makeReq({ 'x-oidc-sub': 'human-1', 'x-oidc-roles': 'Operator' });
      const res = makeRes();
      requireAnyAuthenticated(req, res, () => {
        expect((req as any).principal?.type).toBe('human');
        done();
      });
    });

    test('allows service principal', (done) => {
      const req = makeReq({ 'x-service-id': 'svc-1', 'x-service-roles': 'Operator' });
      const res = makeRes();
      requireAnyAuthenticated(req, res, () => {
        expect((req as any).principal?.type).toBe('service');
        done();
      });
    });

    test('returns 401 for anonymous', () => {
      const req = makeReq();
      const res = makeRes();
      requireAnyAuthenticated(req, res, () => {
        throw new Error('should not call next');
      });
      expect(res.statusCode).toBe(401);
      expect(res.body).toHaveProperty('error', 'unauthenticated');
    });
  });

  describe('requireRoles middleware (SuperAdmin OR Operator)', () => {
    test('401 when anonymous', () => {
      const req = makeReq();
      const res = makeRes();
      const middleware = requireRoles(Roles.SUPERADMIN, Roles.OPERATOR);
      middleware(req, res, () => {
        throw new Error('should not call next');
      });
      expect(res.statusCode).toBe(401);
      expect(res.body).toHaveProperty('error', 'unauthenticated');
    });

    test('403 when authenticated but lacks required roles', () => {
      const req = makeReq({ 'x-oidc-sub': 'user-456', 'x-oidc-roles': 'Auditor' });
      const res = makeRes();
      const middleware = requireRoles(Roles.SUPERADMIN, Roles.OPERATOR);
      middleware(req, res, () => {
        throw new Error('should not call next');
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).toHaveProperty('error', 'forbidden');
    });

    test('200 and principal attached when role present (Operator)', () => {
      const req = makeReq({ 'x-oidc-sub': 'user-789', 'x-oidc-roles': 'Operator,Auditor' });
      const res = makeRes();
      const middleware = requireRoles(Roles.SUPERADMIN, Roles.OPERATOR);
      let nextCalled = false;
      middleware(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
      expect((req as any).principal?.roles).toEqual(expect.arrayContaining([Roles.OPERATOR]));
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
