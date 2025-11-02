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
 * getPrincipalFromRequest
 *
 * Lightweight principal extractor for development and local testing.
 * Production: replace with proper OIDC token validation (extract roles from ID token or introspection)
 *           and mTLS cert mapping for service principals.
 *
 * Current heuristics (dev/testing only):
 * - If header `x-oidc-sub` is present => human principal
 *   - roles parsed from `x-oidc-roles` (comma-separated) or `x-roles`
 * - Else if header `x-service-id` present => service principal
 *   - roles parsed from `x-service-roles` (comma-separated)
 * - Else fallback to anonymous principal
 *
 * NOTE: These headers are for development only and should not be trusted in production.
 */
export function getPrincipalFromRequest(req: Request): Principal {
  // Human/OIDC-style headers (development-only)
  const oidcSub = req.header('x-oidc-sub') || req.header('x-user-id');
  const oidcRoles = req.header('x-oidc-roles') || req.header('x-roles');

  if (oidcSub) {
    const roles = parseRolesHeader(oidcRoles);
    return { type: 'human', id: oidcSub, roles: roles.length ? roles : [] };
  }

  // Service / mTLS-style headers (development-only)
  const serviceId = req.header('x-service-id') || req.header('x-mtls-service');
  const serviceRoles = req.header('x-service-roles') || req.header('x-service-role');

  if (serviceId) {
    const roles = parseRolesHeader(serviceRoles);
    return { type: 'service', id: serviceId, roles: roles.length ? roles : [] };
  }

  // Allow explicit "role override" for quick local testing (NOT for prod)
  const roleOverride = req.header('x-role-override');
  if (roleOverride) {
    return { type: 'human', id: 'dev-override', roles: parseRolesHeader(roleOverride) };
  }

  return { type: 'anonymous', roles: [] };
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

/**
 * Acceptance criteria (short, testable):
 *
 * - getPrincipalFromRequest correctly identifies principals from headers:
 *   Test: Provide headers x-oidc-sub + x-oidc-roles and expect Principal.type === 'human' and roles populated.
 *
 * - requireRoles middleware:
 *   - Returns 401 when no principal/auth present.
 *   - Returns 403 when principal lacks required roles.
 *   - Calls next() when principal has at least one required role and attaches req.principal.
 *   Test: Mount middleware on a test express app and assert responses for various header combos.
 *
 * - hasAnyRole works for single and multiple required roles.
 *   Test: Create Principal with roles ['Operator'] and assert hasAnyRole(principal, ['Operator','Auditor']) === true.
 *
 * - Production note present and obvious: headers are only for dev. Real systems must validate tokens/certs.
 */

