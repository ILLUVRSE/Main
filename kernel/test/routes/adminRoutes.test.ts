import express from 'express';
import request from 'supertest';
import createAdminRouter from '../../src/routes/adminRoutes';
import { Roles } from '../../src/rbac';
import * as dbModule from '../../src/db';

describe('GET /admin/idempotency', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('requires superadmin role', async () => {
    const app = express();
    app.use(createAdminRouter());

    const res = await request(app).get('/admin/idempotency');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'unauthenticated');
  });

  test('returns idempotency keys for superadmin', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).principal = { roles: [Roles.SUPERADMIN] };
      next();
    });
    app.use(createAdminRouter());

    const rows = [
      {
        key: 'key-1',
        method: 'POST',
        path: '/kernel/create',
        request_hash: 'hash-1',
        response_status: 201,
        created_at: '2024-01-01T00:00:00.000Z',
        expires_at: '2024-01-02T00:00:00.000Z',
      },
      {
        key: 'key-2',
        method: 'POST',
        path: '/kernel/sign',
        request_hash: 'hash-2',
        response_status: null,
        created_at: '2024-01-01T01:00:00.000Z',
        expires_at: null,
      },
    ];

    const queryMock = jest.spyOn(dbModule, 'query').mockResolvedValue({
      rows,
      rowCount: rows.length,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const res = await request(app).get('/admin/idempotency').query({ limit: '5' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      keys: [
        {
          key: 'key-1',
          method: 'POST',
          path: '/kernel/create',
          requestHash: 'hash-1',
          responseStatus: 201,
          createdAt: '2024-01-01T00:00:00.000Z',
          expiresAt: '2024-01-02T00:00:00.000Z',
        },
        {
          key: 'key-2',
          method: 'POST',
          path: '/kernel/sign',
          requestHash: 'hash-2',
          responseStatus: null,
          createdAt: '2024-01-01T01:00:00.000Z',
          expiresAt: null,
        },
      ],
    });

    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('SELECT key'), [5]);
  });
});
