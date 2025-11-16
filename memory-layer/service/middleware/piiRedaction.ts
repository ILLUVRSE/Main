/**
 * memory-layer/service/middleware/piiRedaction.ts
 *
 * PII redaction middleware and helpers.
 *
 * Behavior:
 *  - If principal has the read:pii scope, responses are passed through unchanged.
 *  - Otherwise, removes `piiFlags` / `pii_flags` fields and any nested occurrences.
 *  - Applies to JSON responses produced by res.json(...) and JSON strings sent via res.send(...).
 *
 * Safety:
 *  - Middleware is defensive: it never throws; in failure cases it leaves the body unchanged.
 *  - Does not attempt to detect or redact arbitrary PII values (only the structured `piiFlags` markers).
 */

import { Request, Response, NextFunction } from 'express';
import { AuthenticatedPrincipal } from './auth';
import { hasScope, MemoryScopes } from './auth';

/**
 * Return true if principal can read PII.
 */
export const canReadPii = (principal?: AuthenticatedPrincipal): boolean => hasScope(principal, MemoryScopes.READ_PII);

/**
 * Determine whether an object is a plain object suitable for recursion.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Deep clone and strip PII flags recursively.
 * Replaces any property named `piiFlags`, `pii_flags`, or `pii` (case-insensitive) with an empty object.
 */
export function stripPiiFlags(value: unknown): unknown {
  try {
    if (Array.isArray(value)) {
      return value.map((item) => stripPiiFlags(item));
    }

    if (!isPlainObject(value)) {
      return value;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const lower = k.toLowerCase();
      if (lower === 'piiflags' || lower === 'pii_flags' || lower === 'pii') {
        // preserve key but zero out PII flags object
        out[k] = {};
        continue;
      }

      // Recurse into objects/arrays
      if (Array.isArray(v)) {
        out[k] = v.map((item) => stripPiiFlags(item));
      } else if (isPlainObject(v)) {
        out[k] = stripPiiFlags(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  } catch (err) {
    // Fail-open: on error, return original value (do not throw from middleware)
    // eslint-disable-next-line no-console
    console.error('[piiRedaction] stripPiiFlags error:', (err as Error).message || err);
    return value;
  }
}

/**
 * Convenience to redact a response payload if principal lacks READ_PII scope.
 */
export const redactPayloadIfNeeded = <T>(payload: T, principal?: AuthenticatedPrincipal): T => {
  try {
    if (canReadPii(principal)) return payload;
    return stripPiiFlags(payload) as T;
  } catch {
    return payload;
  }
};

/**
 * Express middleware: override res.json and res.send to redact PII flags for unauthorized principals.
 */
export const piiRedactionMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const principal = req.principal as AuthenticatedPrincipal | undefined;

  if (canReadPii(principal)) {
    // authorized to view PII — no-op
    next();
    return;
  }

  // Preserve originals
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  // Override res.json(body)
  res.json = ((body?: any) => {
    try {
      const redacted = stripPiiFlags(body);
      return originalJson(redacted);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[piiRedaction] res.json redaction failed:', (err as Error).message || err);
      return originalJson(body);
    }
  }) as typeof res.json;

  // Override res.send for JSON-like strings and objects
  res.send = ((body?: any) => {
    try {
      if (typeof body === 'string') {
        const trimmed = body.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            const parsed = JSON.parse(body);
            const redacted = stripPiiFlags(parsed);
            return originalSend(JSON.stringify(redacted));
          } catch {
            return originalSend(body);
          }
        }
        return originalSend(body);
      }

      if (Array.isArray(body) || isPlainObject(body)) {
        const redacted = stripPiiFlags(body);
        return originalSend(redacted);
      }

      return originalSend(body);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[piiRedaction] res.send redaction failed:', (err as Error).message || err);
      return originalSend(body);
    }
  }) as typeof res.send;

  next();
};

export default {
  canReadPii,
  stripPiiFlags,
  redactPayloadIfNeeded,
  piiRedactionMiddleware
};

