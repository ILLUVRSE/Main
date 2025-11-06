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
export const Roles = {
  SUPERADMIN: 'SuperAdmin',
  DIVISION_LEAD: 'DivisionLead',
  OPERATOR: 'Operator',
  AUDITOR: 'Auditor',
} as const;

type RoleName = (typeof Roles)[keyof typeof Roles] | string;

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

  // Human/OIDC-style headers (development-only)
  const oidcSub = req.header('x-oidc-sub') || req.header('x-user-id');
  const oidcRoles = req.header('x-oidc-roles') || req.header('x-roles');

  if (oidcSub) {
    const parsed = parseRolesHeader(oidcRoles);
    const roles = normalizeRoles(parsed);
    return { type: 'human', id: oidcSub, roles: roles.length ? roles : [] };
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
export function hasAnyRole(principal: Principal, required: RoleName[] | RoleName): boolean {
  const requiredRoles = Array.isArray(required) ? required : [required];
  const userRoles = (principal.roles || []).map((r) => r.toString());
  for (const rr of requiredRoles) {
    if (userRoles.includes(rr.toString())) return true;
  }
  return false;
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
      principal?: Principal;
    }
  }
}

export function requireRoles(...requiredRoles: RoleName[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const principal = getPrincipalFromRequest(req);
      // Attach for handlers
      req.principal = principal;

      if (principal.type === 'anonymous') {
        return res.status(401).json({ error: 'unauthenticated' });
      }

      if (!hasAnyRole(principal, requiredRoles)) {
        return res.status(403).json({ error: 'forbidden', required: requiredRoles });
      }

      return next();
    } catch (err) {
      console.error('RBAC middleware error:', err);
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
  const principal = getPrincipalFromRequest(req);
  req.principal = principal;
  if (principal.type === 'anonymous') return res.status(401).json({ error: 'unauthenticated' });
  return next();
}

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


