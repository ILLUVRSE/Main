/**
 * kernel/src/middleware/tracing.ts
 *
 * Simple request tracing middleware that propagates or generates an
 * X-Trace-Id header and stores it in AsyncLocalStorage so downstream
 * components (logger, audit) can enrich events.
 */

import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

const storage = new AsyncLocalStorage<{ traceId: string }>();

const TRACE_HEADER = 'x-trace-id';

function sanitizeTraceId(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (!/^[A-Za-z0-9\-:_]{6,128}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = sanitizeTraceId(req.header(TRACE_HEADER));
  const traceId = incoming || crypto.randomUUID();

  res.setHeader('X-Trace-Id', traceId);
  (res.locals as any).traceId = traceId;

  storage.run({ traceId }, () => {
    next();
  });
}

export function getCurrentTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

export default tracingMiddleware;

