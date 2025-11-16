/**
 * memory-layer/service/middleware/piiRedaction.ts
 *
 * PII redaction middleware and helpers.
 *
 * Improvements:
 *  - Stronger safety: also wraps res.send for JSON string responses.
 *  - Keeps existing exported helpers: canReadPii, redactMemoryNodeView, redactPayloadIfNeeded.
 *  - More defensive handling for unexpected shapes and errors (middleware will never crash the request).
 *
 * Behavior:
 *  - If caller has read:pii scope, responses are passed through unchanged.
 *  - Otherwise, removes `piiFlags` / `pii_flags` fields and any nested occurrences.
 *  - Applies to JSON responses produced by res.json(...) and JSON strings sent via res.send(...).
 */

import { Request, Response, NextFunction } from 'express';
import type { AuthenticatedPrincipal } from '../../../kernel/src/middleware/auth';
import type { MemoryNodeView } from '../types';
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
 * Remove PII flags from an object recursively.
 * Preserves shape but replaces any `piiFlags`/`pii_flags` objects with empty objects.
 *
 * NOTE: This deliberately only strips the PII *flags* structure. If you want to redact specific
 * fields (emails, ssn, etc.) implement a separate sanitizer that runs before sending.
 */
const stripPiiFlags = (payload: unknown): unknown => {
  try {
    if (Array.isArray(payload)) {
      return payload.map((item) => stripPiiFlags(item));
    }
    if (!isPlainObject(payload)) {
      return payload;
    }

    const clone: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      const lower = key.toLowerCase();
      if (lower === 'piiflags' || lower === 'pii_flags' || lower === 'pii') {
        // zero out the PII flags object
        clone[key] = {};
        continue;
      }
      // Recurse for nested objects/arrays
      clone[key] = stripPiiFlags(value);
    }
    return clone;
  } catch (err) {
    // In the unlikely event of an error during redaction, fail-open by returning original payload.
    // We log to console for operators to inspect (do not throw).
    // eslint-disable-next-line no-console
    console.error('[piiRedaction] stripPiiFlags error:', (err as Error).message || err);
    return payload;
  }
};

/**
 * Redact MemoryNodeView (returns a copy).
 */
export const redactMemoryNodeView = (node: MemoryNodeView, principal?: AuthenticatedPrincipal): MemoryNodeView =>
  canReadPii(principal)
    ? node
    : {
        ...node,
        piiFlags: {}
      };

/**
 * Generic payload redactor: strips PII flags for non-authorized principals.
 */
export const redactPayloadIfNeeded = <T>(payload: T, principal?: AuthenticatedPrincipal): T =>
  canReadPii(principal) ? payload : (stripPiiFlags(payload) as T);

/**
 * Express middleware: if the principal cannot read PII, override res.json and res.send to strip PII flags.
 * This is defensive and will not modify non-JSON responses.
 */
export const piiRedactionMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const principal = req.principal as AuthenticatedPrincipal | undefined;

  if (canReadPii(principal)) {
    next();
    return;
  }

  // Preserve original methods
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  // Override res.json(body)
  res.json = ((body: unknown) => {
    try {
      const redacted = stripPiiFlags(body);
      // Ensure we still use the original json sender
      return originalJson(redacted);
    } catch (err) {
      // If anything went wrong, log and fall back to original body
      // eslint-disable-next-line no-console
      console.error('[piiRedaction] res.json redaction failed:', (err as Error).message || err);
      return originalJson(body);
    }
  }) as typeof res.json;

  // Override res.send for JSON strings/objects
  res.send = ((body?: any) => {
    try {
      // If body is a string that looks like JSON, attempt parse -> redact -> stringify
      if (typeof body === 'string') {
        const trimmed = body.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            const parsed = JSON.parse(body);
            const redacted = stripPiiFlags(parsed);
            return originalSend(JSON.stringify(redacted));
          } catch {
            // not valid JSON — fall through to send original body
            return originalSend(body);
          }
        }
        // not JSON string, send as-is
        return originalSend(body);
      }

      // If body is object/array, apply redaction
      if (typeof body === 'object' && body !== null) {
        const redacted = stripPiiFlags(body);
        return originalSend(redacted);
      }

      // primitive types — send as-is
      return originalSend(body);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[piiRedaction] res.send redaction failed:', (err as Error).message || err);
      return originalSend(body);
    }
  }) as typeof res.send;

  next();
};

