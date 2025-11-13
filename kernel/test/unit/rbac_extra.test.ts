import { Request, Response } from 'express';
import {
  getPrincipalFromRequest,
  hasRole,
  hasAnyRole,
  requireRoles,
  requireAnyAuthenticated,
  Roles,
} from '../../src/rbac';
import * as roleMappingModule from '../../src/auth/roleMapping';
import { principalFromCert, mapOidcRolesToCanonical } from '../../src/auth/roleMapping';

const ORIGINAL_ENV = { ...process.env };

function buildReq(headers: Record<string, string> = {}): Request {
  const store = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    store.set(key.toLowerCase(), value);
  }
  const req = {
    headers,
    path: '/test',
    method: 'GET',
    header(name: string) {
      return store.get(name.toLowerCase());
    },
    get(name: string) {
      return store.get(name.toLowerCase());
    },
  } as Partial<Request>;
  return req as Request;
}

function buildRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as any,
    status(this: Response & { statusCode: number }, code: number) {
      this.statusCode = code;
      return this;
    },
    json(this: Response & { body: any }, payload: any) {
      this.body = payload;
      return this;
    },
    set(this: Response, field: any, value?: any) {
      if (typeof field === 'string' && typeof value === 'string') {
        headers[field] = value;
      }
      return this;
    },
    get headers() {
      return headers;
    },
  } as Partial<Response> & { statusCode: number; body: any; headers: Record<string, string> };

  return res as Response & { statusCode: number; body: any; headers: Record<string, string> };
}

function createJwt(payload: Record<string, any>): string {
  const encode = (obj: Record<string, any>) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function principalFromJwtFallback(payload: Record<string, any>) {
  const spy = jest.spyOn(roleMappingModule, 'principalFromOidcClaims').mockImplementation(() => {
    throw new Error('mapper skip');
  });
  const token = createJwt(payload);
  const principal = getPrincipalFromRequest(buildReq({ Authorization: `Bearer ${token}` }));
  spy.mockRestore();
  return principal;
}

afterEach(() => {
  jest.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe('getPrincipalFromRequest - human principals', () => {
  test('parses x-oidc-sub with comma/space separated roles', () => {
    const req = buildReq({
      'x-oidc-sub': 'user-123',
      'x-oidc-roles': 'SuperAdmin, division_lead operator   audit-team',
    });
    const principal = getPrincipalFromRequest(req);
    expect(principal.type).toBe('human');
    expect(principal.id).toBe('user-123');
    expect(principal.roles).toEqual(
      expect.arrayContaining([Roles.SUPERADMIN, Roles.DIVISION_LEAD, Roles.OPERATOR, 'audit-team'])
    );
  });

  test('decodes bearer token roles from realm_access and resource_access', () => {
    const token = createJwt({
      sub: 'jwt-user',
      realm_access: { roles: ['superadmin'] },
      resource_access: { dashboard: { roles: ['operator'] }, sentinel: { roles: ['custom-role'] } },
      roles: ['DivisionLead'],
      scope: 'audit reporter',
    });
    const req = buildReq({ Authorization: `Bearer ${token}` });
    const principal = getPrincipalFromRequest(req);
    expect(principal.type).toBe('human');
    expect(principal.id).toBe('jwt-user');
    expect(principal.roles).toEqual(
      expect.arrayContaining([Roles.SUPERADMIN, Roles.OPERATOR, Roles.DIVISION_LEAD, 'custom-role', 'reporter'])
    );
    expect(principal.roles).toEqual(expect.arrayContaining([Roles.AUDITOR]));
  });

  test('uses x-oidc-claims JSON via role mapper', () => {
    const claims = {
      sub: 'claims-user',
      realm_access: { roles: ['operator'] },
      resource_access: { api: { roles: ['divisionlead'] } },
    };
    const req = buildReq({ 'x-oidc-claims': JSON.stringify(claims) });
    const principal = getPrincipalFromRequest(req);
    expect(principal.type).toBe('human');
    expect(principal.id).toBe('claims-user');
    expect(principal.roles).toEqual(expect.arrayContaining([Roles.OPERATOR, Roles.DIVISION_LEAD]));
  });

  test('allows explicit role override when requested', () => {
    const req = buildReq({ 'x-role-override': 'Operator Auditor custom-role' });
    const principal = getPrincipalFromRequest(req);
    expect(principal.type).toBe('human');
    expect(principal.id).toBe('dev-override');
    expect(principal.roles).toEqual(expect.arrayContaining([Roles.OPERATOR, Roles.AUDITOR, 'custom-role']));
  });

  test('creates dev principal when only roles header present', () => {
    const req = buildReq({ 'x-oidc-roles': 'Operator' });
    const principal = getPrincipalFromRequest(req);
    expect(principal.id).toBe('user.dev');
    expect(principal.roles).toEqual([Roles.OPERATOR]);
  });

  test('invalid bearer token payload falls back to anonymous principal', () => {
    const req = buildReq({ Authorization: 'Bearer abc.def' });
    const principal = getPrincipalFromRequest(req);
    expect(principal.type).toBe('anonymous');
  });

  test('ignores bearer token that lacks payload segment entirely', () => {
    const req = buildReq({ Authorization: 'Bearer invalidtoken' });
    const principal = getPrincipalFromRequest(req);
    expect(principal.type).toBe('anonymous');
  });

  test('builds principal from JWT payload when mapper unavailable', () => {
    const token = createJwt({
      sub: 'payload-user',
      realm_access: { roles: ['Operator'] },
      resource_access: { dashboard: { roles: ['DivisionLead'] } },
    });
    jest.isolateModules(() => {
      jest.doMock('../../src/auth/roleMapping', () => ({}));
      const mod = require('../../src/rbac') as typeof import('../../src/rbac');
      const req = buildReq({ Authorization: `Bearer ${token}` });
      const principal = mod.getPrincipalFromRequest(req);
      expect(principal.id).toBe('payload-user');
      expect(principal.roles).toEqual(expect.arrayContaining([Roles.OPERATOR, Roles.DIVISION_LEAD]));
    });
    jest.dontMock('../../src/auth/roleMapping');
  });

  test('captures array roles, string roles, and scope fields from JWT payload', () => {
    const principalWithArray = principalFromJwtFallback({
      sid: 'session-123',
      roles: ['array-role'],
    });
    expect(principalWithArray.id).toBe('session-123');
    expect(principalWithArray.roles).toEqual(expect.arrayContaining(['array-role']));

    const principalWithString = principalFromJwtFallback({
      subject: 'subject-abc',
      roles: 'string-role another',
    });
    expect(principalWithString.id).toBe('subject-abc');
    expect(principalWithString.roles).toEqual(expect.arrayContaining(['string-role', 'another']));

    const principalWithScope = principalFromJwtFallback({
      scope: 'alpha beta',
    });
    expect(principalWithScope.id).toBe('user.dev');
    expect(principalWithScope.roles).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  test('supports x-oidc-claims branch even when mapper omits roles', () => {
    const spy = jest
      .spyOn(roleMappingModule, 'principalFromOidcClaims')
      .mockImplementation((claims: any) => ({
        type: 'human',
        id: claims.sub ?? 'claims-only',
        roles: undefined,
      }) as any);
    const req = buildReq({ 'x-oidc-claims': JSON.stringify({ sub: 'claims-only' }) });
    const principal = getPrincipalFromRequest(req);
    expect(principal.roles).toEqual([]);
    spy.mockRestore();
  });

  test('returns empty roles when x-oidc-sub present without roles header', () => {
    const req = buildReq({ 'x-oidc-sub': 'solo-user' });
    const principal = getPrincipalFromRequest(req);
    expect(principal.roles).toEqual([]);
  });
});

describe('getPrincipalFromRequest - service principals', () => {
  test('parses x-service headers into service principal', () => {
    const req = buildReq({ 'x-service-id': 'svc-1', 'x-service-roles': 'Operator kog' });
    const principal = getPrincipalFromRequest(req);
    expect(principal.type).toBe('service');
    expect(principal.id).toBe('svc-1');
    expect(principal.roles).toEqual(expect.arrayContaining([Roles.OPERATOR, 'kog']));
  });

  test('prefers mapper principal when service cert header provided', () => {
    process.env.SERVICE_ROLE_MAP = JSON.stringify({ 'svc-2': ['Operator'] });
    const req = buildReq({
      'x-service-id': 'svc-2',
      'x-service-cert': JSON.stringify({ subject: { CN: 'svc-2' } }),
    });
    const principal = getPrincipalFromRequest(req);
    expect(principal.type).toBe('service');
    expect(principal.id).toBe('svc-2');
    expect(principal.roles).toEqual([Roles.OPERATOR]);
  });

  test('falls back to service role map via certificate', () => {
    process.env.SERVICE_ROLE_MAP = JSON.stringify({
      'svc-a': [Roles.OPERATOR, Roles.AUDITOR],
    });
    const principal = principalFromCert({ subject: { CN: 'svc-a' } });
    expect(principal.type).toBe('service');
    expect(principal.id).toBe('svc-a');
    expect(principal.roles).toEqual(expect.arrayContaining([Roles.OPERATOR, Roles.AUDITOR]));
  });

  test('maps approver tokens to auditor role when configured', () => {
    process.env.SERVICE_ROLE_MAP = JSON.stringify({
      'upgrade-approver': ['Auditor'],
    });
    const result = principalFromCert({ subject: { CN: 'upgrade-approver' } });
    expect(result.roles).toEqual([Roles.AUDITOR]);
  });
});

describe('role helpers', () => {
  test('hasRole honors case insensitivity and rejects non-array roles', () => {
    expect(hasRole({ roles: ['operator'] }, Roles.OPERATOR)).toBe(true);
    expect(hasRole({ roles: ['Operator'] }, 'operator')).toBe(true);
    expect(hasRole({ roles: undefined }, Roles.OPERATOR)).toBe(false);
    expect(hasRole(undefined, Roles.OPERATOR)).toBe(false);
  });

  test('hasAnyRole works with arrays and singletons', () => {
    const principal = { roles: ['DivisionLead'] };
    expect(hasAnyRole(principal as any, [Roles.SUPERADMIN, Roles.DIVISION_LEAD])).toBe(true);
    expect(hasAnyRole(principal as any, Roles.OPERATOR)).toBe(false);
    expect(hasAnyRole(principal as any, [])).toBe(true);
  });
});

describe('requireAnyAuthenticated middleware', () => {
  test('allows requests with human principal headers', () => {
    const req = buildReq({ 'x-oidc-sub': 'user', 'x-oidc-roles': 'Operator' });
    const res = buildRes();
    const next = jest.fn();
    requireAnyAuthenticated(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).principal).toBeDefined();
  });

  test('allows service principals', () => {
    const req = buildReq({ 'x-service-id': 'svc', 'x-service-roles': 'Operator' });
    const res = buildRes();
    const next = jest.fn();
    requireAnyAuthenticated(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('rejects anonymous callers', () => {
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();
    requireAnyAuthenticated(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthenticated' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 500 when principal resolution throws', () => {
    const req = buildReq({ 'x-oidc-sub': 'user', 'x-oidc-roles': 'Operator' });
    (req as any).header = () => {
      throw new Error('explode');
    };
    const res = buildRes();
    const next = jest.fn();
    requireAnyAuthenticated(req, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'rbac.error' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRoles middleware', () => {
  test('returns 401 for anonymous requests', () => {
    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();
    requireRoles(Roles.SUPERADMIN)(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 403 when user lacks required role', () => {
    const req = buildReq({ 'x-oidc-sub': 'user', 'x-oidc-roles': 'Auditor' });
    const res = buildRes();
    const next = jest.fn();
    requireRoles(Roles.SUPERADMIN, Roles.OPERATOR)(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden' });
    expect(next).not.toHaveBeenCalled();
  });

  test('passes through when any required role present and attaches principal', () => {
    const req = buildReq({ 'x-oidc-sub': 'user', 'x-oidc-roles': 'Operator' });
    const res = buildRes();
    const next = jest.fn();
    requireRoles(Roles.SUPERADMIN, Roles.OPERATOR)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).principal?.roles).toEqual(expect.arrayContaining([Roles.OPERATOR]));
  });

  test('returns 500 when principal extraction throws', () => {
    const req = buildReq({ 'x-oidc-sub': 'user', 'x-oidc-roles': 'Operator' });
    (req as any).header = () => {
      throw new Error('boom');
    };
    const res = buildRes();
    const next = jest.fn();
    requireRoles(Roles.OPERATOR)(req, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'rbac.error' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('mapOidcRolesToCanonical', () => {
  test('maps various spellings into canonical roles', () => {
    const roles = mapOidcRolesToCanonical(['super-admin', 'division lead', 'Ops', 'auditor', 'custom']);
    expect(roles).toEqual([Roles.SUPERADMIN, Roles.DIVISION_LEAD, Roles.OPERATOR, Roles.AUDITOR, 'custom']);
  });

  test('normalizes roles even when role mapper cannot be loaded', () => {
    jest.isolateModules(() => {
      jest.doMock('../../src/auth/roleMapping', () => {
        throw new Error('failed to load');
      });
      const mod = require('../../src/rbac') as typeof import('../../src/rbac');
      const req = buildReq({ 'x-oidc-sub': 'user', 'x-oidc-roles': 'A B' });
      const principal = mod.getPrincipalFromRequest(req);
      expect(principal.roles).toEqual(['A', 'B']);
    });
    jest.dontMock('../../src/auth/roleMapping');
  });

  test('falls back to payload parsing when mapper throws for bearer tokens', () => {
    const spy = jest.spyOn(roleMappingModule, 'principalFromOidcClaims').mockImplementation(() => {
      throw new Error('mapper boom');
    });
    const token = createJwt({
      sub: 'fallback-user',
      realm_access: { roles: ['Operator'] },
    });
    const req = buildReq({ Authorization: `Bearer ${token}` });
    const principal = getPrincipalFromRequest(req);
    expect(principal.id).toBe('fallback-user');
    expect(principal.roles).toEqual([Roles.OPERATOR]);
    spy.mockRestore();
  });
});
