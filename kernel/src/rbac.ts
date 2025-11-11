/**
 * kernel/src/rbac.ts
 *
 * Minimal RBAC utilities and Express middleware for Kernel.
 *
 * Responsibilities:
 * - Parse a principal (user or service) from incoming request headers (placeholder logic).
 * - Provide middleware `requireRoles(...)` that enforces role checks and returns 401/403 accordingly.
 * - Provide helpers to check roles programmatically.
 *
 * IMPORTANT:
 * - This is a *stub* for development. Integrate with OIDC (human auth) and mTLS (service auth)
 *   in production: map tokens/certs to canonical roles and principals.
 * - DO NOT COMMIT SECRETS. Production must verify tokens / certs server-side (not from headers).
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';
import {
  Roles as MiddlewareRoles,
  Role as MiddlewareRole,
  hasRole,
  PrincipalLike,
  requireAuthenticated as middlewareRequireAuthenticated,
} from './middleware/rbac';

/**
 * Types
 */
export type PrincipalType = 'human' | 'service' | 'anonymous';

export interface Principal {
  type: PrincipalType;
  id?: string; // subject id or service id
  roles: string[]; // canonical role names: SuperAdmin, DivisionLead, Operator, Auditor, etc.
}

/**
 * Known roles (canonical)
 */
export const Roles = MiddlewareRoles;

export type RoleName = MiddlewareRole;

/**
 * Dynamic role-mapper loader
 *
 * We require it at runtime inside functions to avoid a static circular import
 * during module initialization (roleMapping may reference this module for types).
 */
function loadRoleMapper(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
    return require('./auth/roleMapping');
  } catch (e) {
    // Not present (or circular during early init); fall back to no-op mapper
    return null;
  }
}

/**
 * parseRolesHeader
 * Parse a comma / space separated roles header into a cleaned array.
 */
function parseRolesHeader(headerValue?: string | undefined | null): string[] {
  if (!headerValue) return [];
  return headerValue
    .split(/[,\s]+/)
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * normalizeRoles
 * Use the roleMapping helper to map incoming role strings into canonical roles when available.
 */
function normalizeRoles(rawRoles: string[]): string[] {
  const mapper = loadRoleMapper();
  if (mapper && typeof mapper.mapOidcRolesToCanonical === 'function') {
    try {
      return mapper.mapOidcRolesToCanonical(rawRoles);
    } catch (e) {
      // ignore mapper errors and fall back to raw roles
    }
  }
  // Default: return unique cleaned roles
  return Array.from(new Set(rawRoles));
}

/**
 * Try to parse a JWT payload **without verifying**. Used only as a dev/test fallback.
 * This decodes the middle JWT segment (payload) as base64url and parses JSON.
 */
function tryDecodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let b = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4 !== 0) b += '=';
    const buf = Buffer.from(b, 'base64');
    const json = buf.toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * getPrincipalFromRequest
 *
 * Lightweight principal extractor for development and local testing.
 * Production: replace with proper OIDC token validation (extract roles from ID token or introspection)
 *           and mTLS cert mapping for service principals.
 *
 * Heuristics (dev/testing only):
 * - If header `x-oidc-claims` (JSON) present -> use principalFromOidcClaims(claims) if mapper available
 * - Else if header `x-oidc-sub` is present => human principal (roles from x-oidc-roles or x-roles)
 * - Else if header `x-service-id` present => service principal (roles from x-service-roles)
 * - Else try Authorization: Bearer <JWT> decode (dev/test fallback)
 * - Else fallback to anonymous principal
 *
 * NOTE: These headers are for development only and should not be trusted in production.
 */
export function getPrincipalFromRequest(req: Request): Principal {
  const mapper = loadRoleMapper();

  // 1) If JSON claims provided, let the mapper parse them if available
  const claimsHeader = req.header('x-oidc-claims');
  if (claimsHeader && mapper && typeof mapper.principalFromOidcClaims === 'function') {
    try {
      const parsed = JSON.parse(claimsHeader);
      const p = mapper.principalFromOidcClaims(parsed) as Principal;
      // ensure roles normalized
      p.roles = normalizeRoles(p.roles || []);
      return p;
    } catch (e) {
      // fall through to header parsing on JSON errors
    }
  }

  // 1.b) Authorization: Bearer <JWT> — test/dev fallback: decode payload without verifying.
  // This is intentionally permissive and only intended for local integration tests.
  const authHeader = (req.header('authorization') || req.header('Authorization') || '').toString();
  const m = authHeader.match(/^\s*Bearer\s+(.+)\s*$/i);
  if (m) {
    const token = m[1];
    const payload = tryDecodeJwtPayload(token);
    if (payload) {
      // If a mapper exists, prefer it to construct canonical principal
      if (mapper && typeof mapper.principalFromOidcClaims === 'function') {
        try {
          const p = mapper.principalFromOidcClaims(payload) as Principal;
          p.roles = normalizeRoles(p.roles || []);
          // Ensure id fallback
          p.id = p.id || String(payload.sub || payload.sid || payload.subject || 'user.dev');
          return p;
        } catch {
          // fallthrough to basic payload extraction
        }
      }

      // Build minimal principal from payload
      const id = String(payload.sub || payload.sid || payload.subject || 'user.dev');
      let roles: string[] = [];
      if (payload?.realm_access && Array.isArray(payload.realm_access.roles)) roles = roles.concat(payload.realm_access.roles);
      if (payload?.resource_access && typeof payload.resource_access === 'object') {
        for (const k of Object.keys(payload.resource_access || {})) {
          const r = payload.resource_access[k]?.roles;
          if (Array.isArray(r)) roles.push(...r);
        }
      }
      if (Array.isArray(payload?.roles)) roles = roles.concat(payload.roles);
      if (typeof payload?.roles === 'string') roles = roles.concat(payload.roles.split(/[,\s]+/).filter(Boolean));
      if (typeof payload?.scope === 'string') roles = roles.concat(payload.scope.split(/\s+/).filter(Boolean));
      // normalize and return
      return { type: 'human', id, roles: normalizeRoles(roles) };
    }
  }

  // Human/OIDC-style headers (development-only)
  const oidcSub = req.header('x-oidc-sub') || req.header('x-user-id');
  const oidcRolesHeader = req.header('x-oidc-roles') || req.header('x-roles');

  if (oidcSub) {
    const parsed = parseRolesHeader(oidcRolesHeader);
    const roles = normalizeRoles(parsed);
    return { type: 'human', id: String(oidcSub), roles: roles.length ? roles : [] };
  }

  // NEW: tolerate `x-oidc-roles` alone (no subject) as a test/dev convenience.
  // Some tests set only roles header and expect /principal to return a principal with roles.
  if (!oidcSub && oidcRolesHeader) {
    const parsed = parseRolesHeader(oidcRolesHeader);
    const roles = normalizeRoles(parsed);
    // Use a stable dev id so tests asserting on principal shape get a reasonable id.
    return { type: 'human', id: 'user.dev', roles: roles.length ? roles : [] };
  }

  // Service / mTLS-style headers (development-only)
  const serviceId = req.header('x-service-id') || req.header('x-mtls-service');
  const serviceRoles = req.header('x-service-roles') || req.header('x-service-role');

  if (serviceId) {
    // if mapper offers principalFromCert and we have a cert header, try that path
    const certHeader = req.header('x-service-cert') || req.header('x-mtls-cert');
    if (certHeader && mapper && typeof mapper.principalFromCert === 'function') {
      try {
        // try parse as JSON cert shape or fallback to subject string
        let certObj: any = certHeader;
        try {
          certObj = JSON.parse(certHeader);
        } catch (_) {
          // leave as string
        }
        const p = mapper.principalFromCert(certObj) as Principal;
        // prefer explicit serviceId header if provided
        p.id = p.id || serviceId;
        p.roles = normalizeRoles(p.roles || []);
        return p;
      } catch (e) {
        // ignore and fall back to header roles
      }
    }

    const parsed = parseRolesHeader(serviceRoles);
    const roles = normalizeRoles(parsed);
    return { type: 'service', id: serviceId, roles: roles.length ? roles : [] };
  }

  // Allow explicit "role override" for quick local testing (NOT for prod)
  const roleOverride = req.header('x-role-override');
  if (roleOverride) {
    const roles = normalizeRoles(parseRolesHeader(roleOverride));
    return { type: 'human', id: 'dev-override', roles };
  }

  return { type: 'anonymous', roles: [] };
}

/**
 * hasAnyRole
 * Returns true if principal has at least one of the required roles.
 */
export { hasRole };

export function hasAnyRole(principal: Principal | undefined, required: RoleName[] | RoleName): boolean {
  const requiredRoles = Array.isArray(required) ? required : [required];
  if (!requiredRoles.length) return true;
  return requiredRoles.some((role) => hasRole(principal as any, role));
}

/**
 * requireRoles(...)
 * Express middleware factory that enforces the caller has *any* of the provided roles.
 * Usage:
 *   app.post('/kernel/division', requireRoles(Roles.SUPERADMIN, Roles.DIVISION_LEAD), handler)
 *
 * Behavior:
 *  - If principal is anonymous => 401 Unauthorized
 *  - If principal authenticated but lacks roles => 403 Forbidden
 *
 * Note:
 *  - It attaches `req.principal` for downstream handlers (typed as Principal).
 */
declare global {
  // Extend Express Request interface for runtime usage (non-invasive)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  namespace Express {
    interface Request {
      principal?: PrincipalLike;
    }
  }
}

export function requireRoles(...requiredRoles: RoleName[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      let principal = req.principal as PrincipalLike | undefined;
      if (!principal) {
        principal = getPrincipalFromRequest(req);
        (req as any).principal = principal as Principal;
      }

      const typedPrincipal = principal as Principal | undefined;
      if (!typedPrincipal || typedPrincipal.type === 'anonymous') {
        logger.warn('rbac.unauthenticated', {
          path: req.path,
          method: req.method,
          requiredRoles,
        });
        return res.status(401).json({ error: 'unauthenticated', requiredRoles });
      }

      if (!hasAnyRole(typedPrincipal, requiredRoles)) {
        logger.warn('rbac.forbidden', {
          path: req.path,
          method: req.method,
          principal: typedPrincipal.id,
          requiredRoles,
        });
        return res.status(403).json({ error: 'forbidden', requiredRoles, required: requiredRoles });
      }

      return next();
    } catch (err) {
      logger.warn('rbac.error', {
        path: req.path,
        method: req.method,
        error: (err as Error).message,
      });
      return res.status(500).json({ error: 'rbac.error' });
    }
  };
}

/**
 * requireAnyAuthenticated
 * Middleware which allows any authenticated principal (human or service), used for endpoints
 * that require authentication but no specific role.
 */
export function requireAnyAuthenticated(req: Request, res: Response, next: NextFunction) {
  try {
    const principal = (req.principal as PrincipalLike | undefined) ?? getPrincipalFromRequest(req);
    (req as any).principal = principal as Principal;
    if (!principal || (principal as Principal).type === 'anonymous') {
      logger.warn('rbac.unauthenticated', { path: req.path, method: req.method });
      return res.status(401).json({ error: 'unauthenticated' });
    }
    return next();
  } catch (err) {
    logger.warn('rbac.error', { path: req.path, method: req.method, error: (err as Error).message });
    return res.status(500).json({ error: 'rbac.error' });
  }
}

export const requireAuthenticated = middlewareRequireAuthenticated;

/**
 * Example usage notes:
 *
 * - For division creation, require DivisionLead or SuperAdmin:
 *     app.post('/kernel/division', requireRoles(Roles.SUPERADMIN, Roles.DIVISION_LEAD), handler);
 *
 * - For audit read-only access, require Auditor or SuperAdmin:
 *     app.get('/kernel/audit/:id', requireRoles(Roles.SUPERADMIN, Roles.AUDITOR), handler);
 *
 * Integration guidance for production:
 * - Validate OIDC ID tokens server-side (do not accept roles from headers).
 * - For services, validate mTLS client certs and map cert identity to service roles.
 * - Consider caching principal lookups (token introspection, authz calls) to reduce latency.
 */

