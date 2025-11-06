import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../../db';
import { authMiddleware, AuthenticatedPrincipal } from '../../middleware/auth';
import { requireRoles, Roles } from '../../middleware/rbac';
import { logger } from '../../logger';

export interface IdempotencyRecord {
  key: string;
  method: string;
  path: string;
  status: number;
  response: unknown;
  principalId?: string;
  createdAt: string;
}

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  save(record: IdempotencyRecord): Promise<void>;
}

class PgIdempotencyStore implements IdempotencyStore {
  private ensured = false;

  private async ensureTable() {
    if (this.ensured) return;
    await query(`
      CREATE TABLE IF NOT EXISTS idempotency (
        key TEXT PRIMARY KEY,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        response JSONB NOT NULL,
        principal_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    this.ensured = true;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    await this.ensureTable();
    const res = await query('SELECT key, method, path, status, response, principal_id, created_at FROM idempotency WHERE key = $1 LIMIT 1', [key]);
    if (!res.rows.length) return null;
    const row = res.rows[0] as any;
    const responseValue = typeof row.response === 'string' ? JSON.parse(row.response) : row.response;
    return {
      key: String(row.key),
      method: String(row.method),
      path: String(row.path),
      status: Number(row.status),
      response: responseValue,
      principalId: row.principal_id ? String(row.principal_id) : undefined,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    };
  }

  async save(record: IdempotencyRecord): Promise<void> {
    await this.ensureTable();
    await query(
      `INSERT INTO idempotency (key, method, path, status, response, principal_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (key) DO UPDATE SET
         status = EXCLUDED.status,
         response = EXCLUDED.response,
         principal_id = EXCLUDED.principal_id,
         created_at = EXCLUDED.created_at`,
      [
        record.key,
        record.method,
        record.path,
        record.status,
        JSON.stringify(record.response ?? {}),
        record.principalId ?? null,
        record.createdAt,
      ],
    );
  }
}

export interface KernelHandlerOptions {
  idempotencyStore?: IdempotencyStore;
  createKernel?
    : (payload: any, principal: AuthenticatedPrincipal) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

const DEFAULT_STATUS = 200;

async function defaultCreateKernel(payload: any, principal: AuthenticatedPrincipal): Promise<Record<string, unknown>> {
  const kernelId = payload?.kernelId || payload?.id || crypto.randomUUID();
  return {
    kernelId,
    status: 'created',
    requestedBy: principal.id,
    metadata: payload?.metadata ?? null,
    createdAt: new Date().toISOString(),
  };
}

function validateIdempotencyKey(req: Request): string {
  const key = req.header('Idempotency-Key');
  if (!key || !key.trim()) {
    throw new Error('missing idempotency key');
  }
  return key.trim();
}

async function handleKernelCreate(
  req: Request,
  res: Response,
  next: NextFunction,
  opts: KernelHandlerOptions,
) {
  try {
    const key = validateIdempotencyKey(req);
    const store = opts.idempotencyStore ?? new PgIdempotencyStore();
    const principal = req.principal as AuthenticatedPrincipal | undefined;
    if (!principal) {
      return res.status(401).json({ error: 'unauthenticated' });
    }

    const existing = await store.get(key);
    if (existing) {
      res.setHeader('Idempotency-Key', key);
      logger.info('kernel.create.idempotent_hit', { key, principal: principal.id, path: req.path });
      return res.status(existing.status).json(existing.response);
    }

    const factory = opts.createKernel ?? defaultCreateKernel;
    const result = await factory(req.body ?? {}, principal);
    const record: IdempotencyRecord = {
      key,
      method: req.method,
      path: req.path,
      status: DEFAULT_STATUS,
      response: result,
      principalId: principal.id,
      createdAt: new Date().toISOString(),
    };

    await store.save(record);
    res.setHeader('Idempotency-Key', key);
    logger.audit('kernel.create', { key, principal: principal.id, kernelId: (result as any).kernelId });
    return res.status(DEFAULT_STATUS).json(result);
  } catch (err) {
    if ((err as Error).message === 'missing idempotency key') {
      return res.status(400).json({ error: 'missing_idempotency_key' });
    }
    return next(err);
  }
}

export function createKernelRouter(options: KernelHandlerOptions = {}): Router {
  const router = Router();
  router.use(authMiddleware);

  router.post(
    '/kernel/create',
    requireRoles(Roles.SUPERADMIN, Roles.OPERATOR),
    (req: Request, res: Response, next: NextFunction) => handleKernelCreate(req, res, next, options),
  );

  return router;
}

export default createKernelRouter;
