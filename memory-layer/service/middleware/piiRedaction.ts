import { Request, Response, NextFunction } from 'express';
import type { AuthenticatedPrincipal } from '../../../kernel/src/middleware/auth';
import type { MemoryNodeView } from '../types';
import { hasScope, MemoryScopes } from './auth';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const stripPiiFlags = (payload: unknown): unknown => {
  if (Array.isArray(payload)) {
    return payload.map((item) => stripPiiFlags(item));
  }
  if (!isPlainObject(payload)) {
    return payload;
  }

  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'piiFlags' || key === 'pii_flags') {
      clone[key] = {};
      continue;
    }
    clone[key] = stripPiiFlags(value);
  }
  return clone;
};

export const canReadPii = (principal?: AuthenticatedPrincipal): boolean => hasScope(principal, MemoryScopes.READ_PII);

export const redactMemoryNodeView = (node: MemoryNodeView, principal?: AuthenticatedPrincipal): MemoryNodeView =>
  canReadPii(principal)
    ? node
    : {
        ...node,
        piiFlags: {}
      };

export const redactPayloadIfNeeded = <T>(payload: T, principal?: AuthenticatedPrincipal): T =>
  canReadPii(principal) ? payload : (stripPiiFlags(payload) as T);

export const piiRedactionMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (canReadPii(req.principal as AuthenticatedPrincipal | undefined)) {
    next();
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => originalJson(stripPiiFlags(body))) as typeof res.json;
  next();
};
