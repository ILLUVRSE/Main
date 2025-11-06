import express, { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { getIdempotencyTableName } from '../idempotency/config';
import { requireRoles, Roles } from '../rbac';

interface IdempotencyRow {
  key: string;
  method: string;
  path: string;
  request_hash: string;
  response_status: number | null;
  created_at: string;
  expires_at: string | null;
}

function parseLimit(raw: unknown): number {
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(Math.floor(parsed), 500);
    }
  }
  return 100;
}

export default function createAdminRouter(): Router {
  const router = express.Router();

  router.get(
    '/admin/idempotency',
    requireRoles(Roles.SUPERADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const limit = parseLimit(req.query.limit);
        const tableName = getIdempotencyTableName();
        const sql = `SELECT key, method, path, request_hash, response_status, created_at, expires_at
          FROM ${tableName}
          ORDER BY created_at DESC
          LIMIT $1`;
        const result = await query<IdempotencyRow>(sql, [limit]);
        const records = result.rows.map((row) => ({
          key: row.key,
          method: row.method,
          path: row.path,
          requestHash: row.request_hash,
          responseStatus: row.response_status != null ? Number(row.response_status) : null,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        }));
        res.json({ keys: records });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
