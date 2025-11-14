import { Request, Response, NextFunction } from 'express';
import { authMiddleware as kernelAuthMiddleware } from '../../../kernel/src/middleware/auth';
import type { AuthenticatedPrincipal } from '../../../kernel/src/middleware/auth';

export { AuthenticatedPrincipal } from '../../../kernel/src/middleware/auth';

export const MemoryScopes = {
  READ: 'memory:read',
  WRITE: 'memory:write',
  LEGAL_HOLD: 'memory:legal_hold',
  ADMIN: 'memory:admin',
  READ_PII: 'read:pii'
} as const;

export type ScopeValue = (typeof MemoryScopes)[keyof typeof MemoryScopes] | string;

type ScopeInput = ScopeValue | ScopeValue[] | { allOf?: ScopeValue[]; anyOf?: ScopeValue[] };

interface NormalizedScopeRequirement {
  allOf: string[];
  anyOf: string[];
}

const normalizeScope = (scope: ScopeValue | undefined): string | null => {
  if (!scope) return null;
  const text = String(scope).trim();
  if (!text) return null;
  return text.toLowerCase();
};

export const authMiddleware = kernelAuthMiddleware;

const sanitizeScopes = (scopes: ScopeValue[] = []): string[] => {
  const normalized = scopes
    .map((scope) => normalizeScope(scope))
    .filter((scope): scope is string => Boolean(scope));
  return Array.from(new Set(normalized));
};

const normalizeRequirement = (input: ScopeInput): NormalizedScopeRequirement => {
  if (typeof input === 'string') {
    return { allOf: sanitizeScopes([input]), anyOf: [] };
  }
  if (Array.isArray(input)) {
    return { allOf: sanitizeScopes(input), anyOf: [] };
  }
  return {
    allOf: sanitizeScopes(input.allOf ?? []),
    anyOf: sanitizeScopes(input.anyOf ?? [])
  };
};

export const resolvePrincipalScopes = (principal?: AuthenticatedPrincipal): string[] => {
  if (!principal || !Array.isArray(principal.roles)) return [];
  return sanitizeScopes(principal.roles);
};

export const hasScope = (principal: AuthenticatedPrincipal | undefined, scope: ScopeValue): boolean => {
  const normalized = normalizeScope(scope);
  if (!normalized) return false;
  const scopes = resolvePrincipalScopes(principal);
  return scopes.includes(normalized);
};

export const requireScopes =
  (input: ScopeInput) => (req: Request, res: Response, next: NextFunction): void => {
    const { allOf, anyOf } = normalizeRequirement(input);
    const principal = req.principal as AuthenticatedPrincipal | undefined;

    if (!principal) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

    const roles = resolvePrincipalScopes(principal);
    const missingAll = allOf.filter((scope) => !roles.includes(scope));
    const hasAny = !anyOf.length || anyOf.some((scope) => roles.includes(scope));

    if (missingAll.length || !hasAny) {
      res.status(403).json({
        error: 'forbidden',
        missingScopes: missingAll,
        anyOf
      });
      return;
    }

    next();
  };
