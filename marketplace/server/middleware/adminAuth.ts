import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';
import settingsService from '../lib/settingsService';
import auth from './auth';

/**
 * requireAdmin
 * Ensures the requester is authenticated and has the 'admin' role.
 *
 * Behaviour:
 * - If req.user is already present (previous middleware), validate role.
 * - Otherwise call the auth.requireAuth middleware to populate req.user.
 * - If user lacks 'admin' role but an admin API key header is provided and matches
 *   settings.admin.apiKey, treat as admin for the request.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    // Ensure user is authenticated (if not already).
    if (!(req as any).user) {
      // auth.requireAuth is async and will send 401 if needed.
      // We call it and wait for it to complete before continuing.
      await auth.requireAuth(req, res, () => {});
    }

    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ ok: false, error: 'authentication required' });
    }

    const roles: string[] = Array.isArray(user.roles) ? user.roles : [];

    if (roles.includes('admin')) {
      return next();
    }

    // Allow admin API key fallback for automation / cli tasks.
    const headerKey = (req.headers['x-admin-key'] as string) || (req.headers['x-api-key'] as string) || (req.query?.adminKey as string);
    if (headerKey) {
      try {
        const expected = await settingsService.get('admin.apiKey');
        // settingsService.get may return undefined or object; normalize to string
        const expectedKey = typeof expected === 'string' ? expected : expected?.value || expected?.key || undefined;
        if (expectedKey && headerKey === expectedKey) {
          // mark request as admin (do not mutate sensitive user object too aggressively)
          (req as any).user = {
            ...(req as any).user,
            roles: Array.from(new Set([...(roles || []), 'admin'])),
          };
          return next();
        }
      } catch (err) {
        logger.warn('adminAuth.settings.fetch_failed', { err });
      }
    }

    return res.status(403).json({ ok: false, error: 'admin role required' });
  } catch (err) {
    logger.error('adminAuth.requireAdmin.failed', { err });
    return res.status(500).json({ ok: false, error: 'authorization check failed' });
  }
}

export default {
  requireAdmin,
};

