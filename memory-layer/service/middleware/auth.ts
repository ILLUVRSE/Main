/**
 * memory-layer/service/middleware/auth.ts
 *
 * Lightweight auth middleware for Memory Layer that is self-contained and
 * type-compatible with express RequestHandler signatures used by server.ts.
 *
 * Goals:
 *  - Provide `authMiddleware` that populates `req.principal` from a safe dev header
 *    (`X-Local-Dev-Principal`) OR (optionally) from Authorization Bearer tokens.
 *  - Provide helpers `requireScopes`, `hasScope`, and `MemoryScopes` for route-level checks.
 *  - Be strongly typed so `app.use('/v1', authMiddleware, ...)` does not require casting.
 *
 * Note: This implementation intentionally keeps auth simple for local/CI/dev.
 * In production you should replace the token parsing / verification with your
 * real OIDC/JWKS verification and map claims => principal.roles properly.
 */

import { RequestHandler, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type AuthenticatedPrincipal = {
  id: string;
  type?: 'user' | 'service' | string;
  roles: string[]; // e.g., ['memory:write', 'memory:read', 'read:pii']
  // optional raw claims for downstream use
  claims?: Record<string, unknown>;
};

// Augment Express Request to include principal
declare global {
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
    }
  }
}

/**
 * Memory-layer well-known scope constants.
 */
export const MemoryScopes = {
  WRITE: 'memory:write',
  READ: 'memory:read',
  READ_PII: 'read:pii',
  LEGAL_HOLD: 'memory:legal_hold',
  ADMIN: 'admin'
} as const;

/**
 * Parse X-Local-Dev-Principal header (JSON string).
 * Example header:
 *   X-Local-Dev-Principal: {"id":"test-service","type":"service","roles":["memory:write","memory:read","read:pii"]}
 *
 * This header is only intended for local development and CI. It must be enabled
 * by operator convention; do not rely on it in production.
 */
function parseLocalDevPrincipal(header?: string | string[] | undefined): AuthenticatedPrincipal | null {
  if (!header) return null;
  const raw = Array.isArray(header) ? header[0] : header;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const id = String((parsed as any).id ?? 'local-dev');
    const type = (parsed as any).type ?? 'service';
    const roles = Array.isArray((parsed as any).roles) ? (parsed as any).roles.map(String) : [];
    return { id, type, roles, claims: parsed };
  } catch {
    return null;
  }
}

/**
 * Minimal JWT-based principal extraction (optional).
 * If JWT verification is required, configure SIGNING_JWT_PUBLIC_KEY or set JWT_SECRET env.
 *
 * This is intentionally permissive for dev; replace verification logic with OIDC/JWKS in production.
 */
function extractPrincipalFromBearer(token?: string | undefined): AuthenticatedPrincipal | null {
  if (!token) return null;
  try {
    // Allow either raw token or "Bearer <token>"
    const raw = token.startsWith('Bearer ') ? token.split(/\s+/)[1] : token;
    // If a JWT public key is configured, attempt to verify; else decode without verifying.
    const jwtPublic = process.env.JWT_PUBLIC_KEY;
    const jwtSecret = process.env.JWT_SECRET; // fallback symmetric secret (dev)
    let payload: any;
    if (jwtPublic) {
      payload = jwt.verify(raw, jwtPublic, { algorithms: ['RS256', 'ES256', 'ES384', 'ES512'] });
    } else if (jwtSecret) {
      payload = jwt.verify(raw, jwtSecret);
    } else {
      // decode without verify for convenience (not recommended in prod)
      payload = jwt.decode(raw);
    }

    if (!payload || typeof payload !== 'object') return null;
    // Map common claim names to principal
    const sub = (payload as any).sub ?? (payload as any).client_id ?? 'jwt-sub';
    const typ = (payload as any).typ ?? (payload as any).token_type ?? 'user';
    // roles may be in 'roles', 'scope' (space-separated), or 'scopes'
    let roles: string[] = [];
    if (Array.isArray((payload as any).roles)) roles = (payload as any).roles.map(String);
    else if (typeof (payload as any).scope === 'string') roles = (payload as any).scope.split(/\s+/);
    else if (typeof (payload as any).scopes === 'string') roles = (payload as any).scopes.split(/\s+/);
    return { id: String(sub), type: typ, roles, claims: payload as Record<string, unknown> };
  } catch {
    // On any token error, return null (treat as unauthenticated)
    return null;
  }
}

/**
 * Main auth middleware that populates req.principal if possible.
 * Does not reject requests by default; route-level guards enforce scope.
 */
export const authMiddleware: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  try {
    // 1) Prefer local-dev header (useful for CI/dev)
    const localHeader = req.header('x-local-dev-principal') ?? req.header('X-Local-Dev-Principal');
    const devPrincipal = parseLocalDevPrincipal(localHeader ?? undefined);
    if (devPrincipal) {
      req.principal = devPrincipal;
      return next();
    }

    // 2) Try Authorization Bearer
    const authHeader = req.header('authorization') ?? req.header('Authorization');
    if (authHeader) {
      const principal = extractPrincipalFromBearer(authHeader);
      if (principal) {
        req.principal = principal;
        return next();
      }
    }

    // 3) No principal found: set an anonymous principal with no roles
    req.principal = { id: 'anonymous', type: 'anonymous', roles: [] };
    return next();
  } catch (err) {
    // On unexpected error, set anonymous and continue (route-level can reject)
    req.principal = { id: 'anonymous', type: 'anonymous', roles: [] };
    return next();
  }
};

/**
 * Helper: return true if principal has the given scope
 */
export function hasScope(principal: AuthenticatedPrincipal | undefined, scope: string): boolean {
  if (!principal) return false;
  const roles = principal.roles ?? [];
  return roles.includes(scope);
}

/**
 * requireScopes: middleware factory to enforce scopes.
 *
 * Accepts either:
 *  - a single scope string, or
 *  - an object { anyOf: string[] } to allow any of the scopes,
 *  - or an object { allOf: string[] } to require all scopes.
 *
 * Example:
 *   requireScopes(MemoryScopes.WRITE)
 *   requireScopes({ anyOf: [MemoryScopes.LEGAL_HOLD, MemoryScopes.ADMIN] })
 */
export function requireScopes(spec: string | { anyOf?: string[]; allOf?: string[] }): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({ error: { message: 'unauthenticated' } });
      return;
    }

    if (typeof spec === 'string') {
      if (!hasScope(principal, spec)) {
        res.status(403).json({ error: { message: 'forbidden: missing scope' } });
        return;
      }
      return next();
    }

    if (spec.anyOf && Array.isArray(spec.anyOf)) {
      const ok = spec.anyOf.some((s) => hasScope(principal, s));
      if (!ok) {
        res.status(403).json({ error: { message: 'forbidden: requires one of the scopes' } });
        return;
      }
      return next();
    }

    if (spec.allOf && Array.isArray(spec.allOf)) {
      const ok = spec.allOf.every((s) => hasScope(principal, s));
      if (!ok) {
        res.status(403).json({ error: { message: 'forbidden: requires all scopes' } });
        return;
      }
      return next();
    }

    // default deny
    res.status(403).json({ error: { message: 'forbidden' } });
  };
}

export default {
  authMiddleware,
  requireScopes,
  hasScope,
  MemoryScopes
};

