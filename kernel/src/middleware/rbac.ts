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

function normalize(role: string): string {
  return role.trim().toLowerCase();
}

export function hasRole(user: AuthenticatedPrincipal | undefined, role: Role): boolean {
  if (!user || !Array.isArray(user.roles)) return false;
  const target = normalize(String(role));
  return user.roles.some((r) => normalize(String(r)) === target);
}

function hasAnyRole(user: AuthenticatedPrincipal | undefined, required: Role[]): boolean {
  if (!user) return false;
  if (!required.length) return true;
  return required.some((role) => hasRole(user, role));
}

export function requireAuthenticated(req: Request, res: Response, next: NextFunction) {
  const principal = req.principal as AuthenticatedPrincipal | undefined;
  if (!principal) {
    logger.warn('rbac.unauthenticated', { path: req.path, method: req.method });
    return res.status(401).json({ error: 'unauthenticated' });
  }
  return next();
}

export function requireRoles(...requiredRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const principal = req.principal as AuthenticatedPrincipal | undefined;
    if (!principal) {
      logger.warn('rbac.unauthenticated', { path: req.path, method: req.method });
      return res.status(401).json({ error: 'unauthenticated' });
    }

    if (!hasAnyRole(principal, requiredRoles)) {
      logger.warn('rbac.forbidden', {
        path: req.path,
        method: req.method,
        principal: principal.id,
        requiredRoles,
      });
      return res.status(403).json({ error: 'forbidden', requiredRoles });
    }

    return next();
  };
}

export function enforceRoles(principal: AuthenticatedPrincipal | undefined, roles: Role[]): void {
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
  requireRoles,
  requireAuthenticated,
  enforceRoles,
};
