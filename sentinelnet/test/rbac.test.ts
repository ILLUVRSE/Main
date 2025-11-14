import type { Request, Response, NextFunction, RequestHandler } from 'express';

const ORIGINAL_ENV = { ...process.env };

function buildReq(headers: Record<string, string>): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()] ?? headers[name] ?? undefined,
  } as unknown as Request;
}

function buildRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockImplementation(() => res);
  res.json = jest.fn().mockImplementation(() => res);
  return res as Response;
}

async function execMiddleware(mw: RequestHandler, headers: Record<string, string>) {
  return new Promise<{ allowed: boolean; status?: number }>((resolve) => {
    const req = buildReq(headers);
    const res = buildRes();
    (res.status as jest.Mock).mockImplementation((code: number) => {
      (res.json as jest.Mock).mockImplementation(() => resolve({ allowed: false, status: code }));
      return res;
    });
    const next: NextFunction = () => resolve({ allowed: true });
    mw(req, res, next);
  });
}

describe('RBAC middleware', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      SENTINEL_RBAC_ENABLED: 'true',
      SENTINEL_RBAC_HEADER: 'x-roles',
      SENTINEL_RBAC_CHECK_ROLES: 'kernel-service',
      SENTINEL_RBAC_POLICY_ROLES: 'kernel-admin',
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('allows request when role present', async () => {
    const rbac = require('../src/http/rbac').default;
    const middleware = rbac.requireRole('check');
    const result = await execMiddleware(middleware, { 'x-roles': 'kernel-service' });
    expect(result.allowed).toBe(true);
  });

  it('blocks request when role missing', async () => {
    const rbac = require('../src/http/rbac').default;
    const middleware = rbac.requireRole('policy');
    const result = await execMiddleware(middleware, { 'x-roles': 'kernel-service' });
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(403);
  });
});
