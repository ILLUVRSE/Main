import express, { Request, Response } from 'express';
import request from '../utils/mockSupertest';
import { hasRole, requireRoles, requireAuthenticated, Roles } from '../../src/middleware/rbac';
import { AuthenticatedPrincipal } from '../../src/middleware/auth';

describe('middleware/rbac', () => {
  test('hasRole respects case insensitive matches', () => {
    const user: AuthenticatedPrincipal = {
      id: 'user-1',
      type: 'human',
      roles: ['SuperAdmin'],
      source: 'oidc',
    };
    expect(hasRole(user, 'superadmin')).toBe(true);
    expect(hasRole(user, Roles.OPERATOR)).toBe(false);
  });

  test('requireRoles returns 403 when role missing', async () => {
    const app = express();
    app.get(
      '/test',
      (req: Request, _res: Response, next) => {
        req.principal = {
          id: 'user',
          type: 'human',
          roles: ['Auditor'],
          source: 'oidc',
        } as any;
        next();
      },
      requireRoles(Roles.OPERATOR),
      (_req, res) => res.json({ ok: true }),
    );

    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error', 'forbidden');
  });

  test('requireRoles allows when role present', async () => {
    const app = express();
    app.get(
      '/ok',
      (req: Request, _res: Response, next) => {
        req.principal = {
          id: 'user',
          type: 'human',
          roles: ['Operator'],
          source: 'oidc',
        } as any;
        next();
      },
      requireRoles(Roles.OPERATOR),
      (_req, res) => res.json({ ok: true }),
    );

    const res = await request(app).get('/ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('requireAuthenticated rejects anonymous', async () => {
    const app = express();
    app.get('/auth', requireAuthenticated, (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/auth');
    expect(res.status).toBe(401);
  });
});
