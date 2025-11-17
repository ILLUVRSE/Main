import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';
import userService from '../lib/userService';

/**
 * Parse a bearer token from Authorization header or cookie.
 */
function parseBearerToken(req: Request): string | null {
  const auth = (req.headers.authorization as string) || req.cookies?.authorization || req.cookies?.auth || null;
  if (!auth) return null;
  // Typical header: "Bearer <token>"
  const parts = auth.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  // Fallback: raw token
  if (parts.length === 1 && parts[0].length > 20) return parts[0];
  return null;
}

/**
 * requireAuth
 * Middleware that verifies an access token and attaches `req.user` for downstream handlers.
 * Expects userService.verifyToken(token) -> { id, email, roles, ... } or null.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = parseBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: 'missing authorization token' });
    }

    // Delegate verification to userService. This keeps provider details out of middleware.
    // userService.verifyToken should validate signatures, expiry, and return a user object.
    const user = await userService.verifyToken(token);
    if (!user) {
      return res.status(401).json({ ok: false, error: 'invalid or expired token' });
    }

    // Attach minimal safe user on request
    (req as any).user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: Array.isArray(user.roles) ? user.roles : [],
      metadata: user.metadata || {},
    };

    next();
  } catch (err) {
    logger.error('auth.requireAuth.failed', { err });
    return res.status(401).json({ ok: false, error: 'authentication failed' });
  }
}

/**
 * optionalAuth
 * If a valid token is present it attaches req.user, otherwise it proceeds anonymously.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = parseBearerToken(req);
    if (!token) return next();

    const user = await userService.verifyToken(token);
    if (!user) return next();

    (req as any).user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: Array.isArray(user.roles) ? user.roles : [],
      metadata: user.metadata || {},
    };

    return next();
  } catch (err) {
    logger.warn('auth.optionalAuth.verify.failed', { err });
    return next();
  }
}

/**
 * ensureRole(role)
 * Returns middleware that verifies the authenticated user has the given role.
 * Requires requireAuth to have run previously (or will run it).
 */
export function ensureRole(role: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // If no user is present, enforce auth first
      if (!(req as any).user) {
        // try to authenticate
        await requireAuth(req, res, (err?: any) => {
          if (err) throw err;
        });
      }

      const user = (req as any).user;
      if (!user) return res.status(403).json({ ok: false, error: 'not authorized' });

      if (!Array.isArray(user.roles) || !user.roles.includes(role)) {
        return res.status(403).json({ ok: false, error: 'insufficient role' });
      }

      return next();
    } catch (err) {
      logger.error('auth.ensureRole.failed', { err });
      return res.status(403).json({ ok: false, error: 'authorization failed' });
    }
  };
}

export default {
  requireAuth,
  optionalAuth,
  ensureRole,
};

