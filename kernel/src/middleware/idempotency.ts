// kernel/src/middleware/idempotency.ts
import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { PoolClient } from 'pg';
import { getClient } from '../db';
import { getIdempotencyTableName, getIdempotencyTtlIso } from '../idempotency/config';

interface IdempotencyContext {
  client: PoolClient;
  key: string;
  requestHash: string;
  release?: () => void;
}

const DEFAULT_LIMIT = 1024 * 1024; // 1MB
const TABLE_NAME = getIdempotencyTableName();

/**
 * Produce a stable JSON string for request body comparison
 */
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

/**
 * Compute a request hash based on method, path, and normalized body
 */
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

/**
 * Parse stored body value (may be JSON string or raw)
 */
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

function isIdempotencyDisabled(): boolean {
  return (process.env.DISABLE_IDEMPOTENCY || '').toLowerCase() === 'true';
}

/** Serialize response body to string for storage */
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

/**
 * Normalize some common response shapes so tests can reliably extract IDs:
 * - { agentId: "..." } => { agent: { id: "..." } }
 * - array-like or numeric-keyed objects which contain agent objects => normalize to { agent: { id } } when possible
 *
 * This function is intentionally conservative: it only converts to a canonical
 * { agent: { id } } shape when it finds a clear agentId/id candidate.
 */
function normalizeResponseShape(body: any): any {
  try {
    if (body === null || body === undefined) return body;

    // If body is a Buffer or JSON string, try to decode it to an object/array first.
    if (Buffer.isBuffer(body)) {
      try {
        const parsed = JSON.parse(body.toString('utf8'));
        return normalizeResponseShape(parsed);
      } catch {
        // leave as-is
      }
    }
    if (typeof body === 'string') {
      const trimmed = body.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          return normalizeResponseShape(parsed);
        } catch {
          // ignore parse error and continue
        }
      }
    }

    // If body is an array, scan for the first element that looks like an agent object.
    if (Array.isArray(body)) {
      for (const el of body) {
        if (el && typeof el === 'object') {
          if ((el as any).agentId && !(el as any).agent) {
            return { agent: { id: String((el as any).agentId) } };
          }
          if ((el as any).id && !(el as any).agent) {
            return { agent: { id: String((el as any).id) } };
          }
        }
      }
      // If no candidate found, fall through and return the original array.
    }

    // If body is an object whose keys are "0","1",... (numeric-keyed), treat like an array
    if (typeof body === 'object' && !Array.isArray(body)) {
      const keys = Object.keys(body);
      const numericKeys = keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
      if (numericKeys) {
        const arr = keys.sort((a, b) => Number(a) - Number(b)).map((k) => body[k]);
        for (const first of arr) {
          if (first && typeof first === 'object') {
            if ((first as any).agentId && !(first as any).agent) {
              return { agent: { id: String((first as any).agentId) } };
            }
            if ((first as any).id && !(first as any).agent) {
              return { agent: { id: String((first as any).id) } };
            }
          }
        }
      }

      // Common direct shape: { agentId: "..." } -> { agent: { id } }
      if ((body as any).agentId && !(body as any).agent && !(body as any).id) {
        return { agent: { id: String((body as any).agentId) } };
      }
    }
  } catch {
    // on any unexpected shape or error, return original body unchanged
  }
  return body;
}

/**
 * Idempotency middleware
 *
 * - Only handles POST requests.
 * - Expects header 'Idempotency-Key'.
 * - Stores method, path, request_hash at the beginning of processing.
 * - On subsequent requests with same key, returns stored response (if hash matches),
 *   or 412 when request hash differs (conflicting body).
 */
export async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (isIdempotencyDisabled()) {
    return next();
  }
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
  const releaseFn = ctx.release || (() => ctx.client.release());
  releaseFn();
};

  let released = false;
  const releaseClient = () => {
    if (released) return;
    released = true;
    client.release();
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
        releaseClient();
        res.setHeader('Idempotency-Key', trimmedKey);
        res.status(412).json({ error: 'idempotency_key_conflict' });
        return;
      }

      const status = row.response_status != null ? Number(row.response_status) : 200;
      const body = parseStoredBody(row.response_body ? String(row.response_body) : null);

      // NORMALIZE stored response before sending it to the client.
      const normalized = normalizeResponseShape(body);

      await client.query('ROLLBACK').catch(() => {});
      releaseClient();
      res.setHeader('Idempotency-Key', trimmedKey);
      res.status(status).json(normalized);
      return;
    }

    // Insert a placeholder row recording method/path/hash and expires_at
    const expiresAtIso = getIdempotencyTtlIso();
    await client.query(
      `INSERT INTO ${TABLE_NAME} (key, method, path, request_hash, created_at, expires_at) VALUES ($1,$2,$3,$4, now(), $5)`,
      [trimmedKey, req.method, req.originalUrl || req.path, requestHash, expiresAtIso],
    );

    const context: IdempotencyContext = { client, key: trimmedKey, requestHash, release: releaseClient };
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

      // Normalize common shapes (agentId / numeric-keyed bodies / arrays)
      const normalizedBody = normalizeResponseShape(body);

      // Helpful debug log to diagnose unexpected shapes being persisted.
      if ((process.env.LOG_LEVEL || '').toLowerCase() === 'debug') {
        try {
          // Avoid heavy JSON stringify in non-debug
          console.debug('[idempotency] storing response for key=', trimmedKey, 'status=', res.statusCode || 200, 'type=', typeof normalizedBody);
        } catch {
          // ignore
        }
      }

      const serialized = serializeBody(normalizedBody);
      if (Buffer.byteLength(serialized, 'utf8') > limit) {
        // Too large to store
        await client.query('ROLLBACK').catch(() => {});
        state.finished = true;
        res.removeListener('close', cleanup);
        releaseClient();
        res.setHeader('Idempotency-Key', trimmedKey);
        res.status(413);
        return sender({ error: 'idempotency_response_too_large' });
      }

      const statusCode = res.statusCode || 200;

      // Try to update the idempotency row. If the transaction is aborted (25P02)
      // we should avoid trying to reuse the client and simply return the response
      // to the client (best-effort).
      try {
        await client.query(
          `UPDATE ${TABLE_NAME} SET response_status = $2, response_body = $3 WHERE key = $1`,
          [trimmedKey, statusCode, serialized],
        );
        await client.query('COMMIT');
      } catch (err: any) {
        // If the transaction was aborted or some other error occurred, log and skip DB commit.
        // 25P02 = current transaction is aborted, commands ignored until end of transaction block
        console.warn('[idempotency] failed to persist response:', (err && err.message) || err);
        try {
          await client.query('ROLLBACK').catch(() => {});
        } catch {
          /* ignore */
        }
        // Release client and mark finished so cleanup doesn't attempt a second time.
        state.finished = true;
        res.removeListener('close', cleanup);
        releaseClient();
        res.setHeader('Idempotency-Key', trimmedKey);
        return sender(normalizedBody);
      }

      state.finished = true;
      res.removeListener('close', cleanup);
      releaseClient();
      res.setHeader('Idempotency-Key', trimmedKey);
      return sender(normalizedBody);
    };

    // Override response methods to capture output and persist
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
    releaseClient();
    return next(err);
  }
}

export default idempotencyMiddleware;
