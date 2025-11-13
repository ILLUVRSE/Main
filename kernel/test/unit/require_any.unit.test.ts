// kernel/test/unit/require_any.unit.test.ts
import express from 'express';
import request from '../utils/mockSupertest';
import { requireAnyAuthenticated } from '../../src/rbac';

describe('requireAnyAuthenticated middleware', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    app.get('/any', requireAnyAuthenticated, (req, res) => {
      return res.json({ ok: true, principal: (req as any).principal });
    });
  });

  test('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/any');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'unauthenticated');
  });

  test('allows human principal with x-oidc-sub header', async () => {
    const res = await request(app)
      .get('/any')
      .set('x-oidc-sub', 'user-1')
      .set('x-oidc-roles', 'Operator');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body.principal).toMatchObject({ type: 'human', id: 'user-1' });
    expect(Array.isArray(res.body.principal.roles)).toBe(true);
  });

  test('allows service principal with x-service-id header', async () => {
    const res = await request(app)
      .get('/any')
      .set('x-service-id', 'svc-123')
      .set('x-service-roles', 'Operator');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body.principal).toMatchObject({ type: 'service', id: 'svc-123' });
    expect(Array.isArray(res.body.principal.roles)).toBe(true);
  });
});
