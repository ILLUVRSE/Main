import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';
import { AuthenticatedPrincipal } from './auth';

export const Roles = {
  SUPERADMIN: 'SuperAdmin',
  DIVISION_LEAD: 'DivisionLead',
  OPERATOR: 'Operator',
  AUDITOR: 'Auditor',
};

export type Role = (typeof Roles)[keyof typeof Roles] | string;

type RoleCandidate = string | { toString(): string } | null | undefined;

export type PrincipalLike =
  | (Partial<AuthenticatedPrincipal> & { roles?: RoleCandidate[] | undefined })
  | { roles?: RoleCandidate[] | undefined; id?: string }
  | null
  | undefined;

export function normalizeRole(role: RoleCandidate): string {
  if (role === null || role === undefined) return '';
  const value = typeof role === 'string' ? role : String(role);
  return value.trim().toLowerCase();
}

export function hasRole(user: PrincipalLike, role: Role): boolean {
  const target = normalizeRole(role);
  if (!target) return false;
  if (!user || !Array.isArray(user.roles)) return false;
  return user.roles.some((candidate) => normalizeRole(candidate) === target);
}

export function hasAnyRole(user: PrincipalLike, required: Role[] | Role): boolean {
  const requiredRoles = Array.isArray(required) ? required : [required];
  if (!requiredRoles.length) return true;
  return requiredRoles.some((role) => hasRole(user, role));
}

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Request {
      principal?: PrincipalLike;
    }
  }
}

export function requireAuthenticated(req: Request, res: Response, next: NextFunction) {
  const principal = req.principal as PrincipalLike;
  if (!principal) {
    logger.warn('rbac.unauthenticated', { path: req.path, method: req.method });
    return res.status(401).json({ error: 'unauthenticated' });
  }
  return next();
}

export function requireRoles(...requiredRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const principal = req.principal as PrincipalLike;
    if (!principal) {
      logger.warn('rbac.unauthenticated', {
        path: req.path,
        method: req.method,
        requiredRoles,
      });
      return res.status(401).json({ error: 'unauthenticated', requiredRoles });
    }

    if (!hasAnyRole(principal, requiredRoles)) {
      logger.warn('rbac.forbidden', {
        path: req.path,
        method: req.method,
        principal: (principal as AuthenticatedPrincipal | undefined)?.id,
        requiredRoles,
      });
      return res
        .status(403)
        .json({ error: 'forbidden', requiredRoles, required: requiredRoles });
    }

    return next();
  };
}

export function enforceRoles(principal: PrincipalLike, roles: Role[]): void {
  if (!principal) {
    throw new Error('unauthenticated');
  }
  if (!hasAnyRole(principal, roles)) {
    throw new Error('forbidden');
  }
}

export default {
  Roles,
  hasRole,
  hasAnyRole,
  requireRoles,
  requireAuthenticated,
  enforceRoles,
};
