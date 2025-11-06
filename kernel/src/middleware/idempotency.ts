import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { PoolClient } from 'pg';
import { getClient } from '../db';
import { getIdempotencyTableName, getIdempotencyTtlIso } from '../idempotency/config';

interface IdempotencyContext {
  client: PoolClient;
  key: string;
  requestHash: string;
}

const DEFAULT_LIMIT = 1024 * 1024; // 1MB
const TABLE_NAME = getIdempotencyTableName();

function stableStringify(value: any): string {
  const normalize = (input: any): any => {
    if (input === null || typeof input !== 'object') {
      return input;
    }
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(input).sort()) {
      sorted[key] = normalize(input[key]);
    }
    return sorted;
  };

  try {
    return JSON.stringify(normalize(value));
  } catch {
    return JSON.stringify(String(value));
  }
}

function computeRequestHash(req: Request): string {
  const bodyString = stableStringify(req.body ?? null);
  const path = req.originalUrl || req.path;
  return crypto
    .createHash('sha256')
    .update(req.method)
    .update('|')
    .update(path)
    .update('|')
    .update(bodyString)
    .digest('hex');
}

function parseStoredBody(raw: string | null): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getLimit(): number {
  const raw = process.env.IDEMPOTENCY_RESPONSE_BODY_LIMIT;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return parsed;
}

function serializeBody(body: any): string {
  if (body === undefined) return 'null';
  if (body === null) return 'null';
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  try {
    return JSON.stringify(body);
  } catch {
    return JSON.stringify(String(body));
  }
}

export async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method.toUpperCase() !== 'POST') {
    return next();
  }

  const key = req.header('Idempotency-Key');
  if (!key || !key.trim()) {
    res.status(400).json({ error: 'missing_idempotency_key' });
    return;
  }

  const trimmedKey = key.trim();
  const requestHash = computeRequestHash(req);
  const client = await getClient();

  const finalizeCleanup = async (ctx: IdempotencyContext, done: { finished: boolean }): Promise<void> => {
    if (done.finished) {
      return;
    }
    done.finished = true;
    try {
      await ctx.client.query('ROLLBACK');
    } catch {
      // ignore rollback error during cleanup
    }
    ctx.client.release();
  };

  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT method, path, request_hash, response_status, response_body FROM ${TABLE_NAME} WHERE key = $1 FOR UPDATE`,
      [trimmedKey],
    );

    if (existing.rowCount && existing.rows.length) {
      const row = existing.rows[0] as any;
      const storedHash = row.request_hash ? String(row.request_hash) : '';
      if (storedHash && storedHash !== requestHash) {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
        res.setHeader('Idempotency-Key', trimmedKey);
        res.status(412).json({ error: 'idempotency_key_conflict' });
        return;
      }

      const status = row.response_status != null ? Number(row.response_status) : 200;
      const body = parseStoredBody(row.response_body ? String(row.response_body) : null);
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      res.setHeader('Idempotency-Key', trimmedKey);
      res.status(status).json(body);
      return;
    }

    const expiresAtIso = getIdempotencyTtlIso();
    await client.query(
      `INSERT INTO ${TABLE_NAME} (key, method, path, request_hash, created_at, expires_at) VALUES ($1,$2,$3,$4, now(), $5)`,
      [trimmedKey, req.method, req.originalUrl || req.path, requestHash, expiresAtIso],
    );

    const context: IdempotencyContext = { client, key: trimmedKey, requestHash };
    res.locals.idempotency = context;
    const state = { finished: false };

    const cleanup = () => {
      void finalizeCleanup(context, state);
    };
    res.once('close', cleanup);

    const limit = getLimit();
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    const finalizeAndSend = async (body: any, sender: (payload: any) => any) => {
      if (state.finished) {
        return sender(body);
      }

      const serialized = serializeBody(body);
      if (Buffer.byteLength(serialized, 'utf8') > limit) {
        await client.query('ROLLBACK').catch(() => {});
        state.finished = true;
        res.removeListener('close', cleanup);
        client.release();
        res.setHeader('Idempotency-Key', trimmedKey);
        res.status(413);
        return sender({ error: 'idempotency_response_too_large' });
      }

      const statusCode = res.statusCode || 200;
      await client.query(
        `UPDATE ${TABLE_NAME} SET response_status = $2, response_body = $3 WHERE key = $1`,
        [trimmedKey, statusCode, serialized],
      );
      await client.query('COMMIT');
      state.finished = true;
      res.removeListener('close', cleanup);
      client.release();
      res.setHeader('Idempotency-Key', trimmedKey);
      return sender(body);
    };

    res.json = ((body?: any) => {
      return finalizeAndSend(body, originalJson);
    }) as any;

    res.send = ((body?: any) => {
      return finalizeAndSend(body, originalSend);
    }) as any;

    return next();
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    client.release();
    return next(err);
  }
}

export default idempotencyMiddleware;
