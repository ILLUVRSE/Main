import express, { Request, Response, NextFunction } from 'express';
import logger from '../../lib/logger';
import auditWriter from '../../lib/auditWriter';
import { requireAdmin } from '../../middleware/adminAuth';
import userService from '../../lib/userService';

const router = express.Router();

// All admin routes require admin auth
router.use(requireAdmin);

/**
 * Helper to parse query params for listing users
 */
function parseListQuery(req: Request) {
  const q = (req.query.q as string) || '';
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 25)));
  const role = (req.query.role as string) || undefined;
  const activeParam = req.query.active;
  const active =
    typeof activeParam === 'string' ? (activeParam === 'true' ? true : activeParam === 'false' ? false : undefined) : undefined;

  return { q, page, limit, role, active };
}

/**
 * GET /admin/users
 * List users with optional search, role filter, active flag, pagination
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, page, limit, role, active } = parseListQuery(req);
    const result = await userService.list({
      q,
      page,
      limit,
      role,
      active,
    });

    res.json({
      ok: true,
      items: result.items,
      meta: {
        total: result.total,
        page,
        limit,
      },
    });
  } catch (err) {
    logger.error('admin.users.list.failed', { err });
    next(err);
  }
});

/**
 * GET /admin/users/:id
 * Fetch a single user
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const user = await userService.getById(id);
    if (!user) return res.status(404).json({ ok: false, error: 'user not found' });
    res.json({ ok: true, user });
  } catch (err) {
    logger.error('admin.users.get.failed', { err });
    next(err);
  }
});

/**
 * PATCH /admin/users/:id
 * Update user metadata: displayName, email, metadata object
 * Body: { displayName?: string, email?: string, metadata?: object }
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { displayName, email, metadata } = req.body ?? {};

    if (email && typeof email !== 'string') {
      return res.status(400).json({ ok: false, error: 'invalid email' });
    }

    const changes: any = {};
    if (typeof displayName === 'string') changes.displayName = displayName;
    if (typeof email === 'string') changes.email = email;
    if (metadata && typeof metadata === 'object') changes.metadata = metadata;

    const updated = await userService.update(id, changes);
    if (!updated) return res.status(404).json({ ok: false, error: 'user not found' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.user.update',
      details: { userId: id, changes },
    });

    res.json({ ok: true, user: updated });
  } catch (err) {
    logger.error('admin.users.update.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/users/:id/roles
 * Replace user's roles
 * Body: { roles: string[] }
 */
router.post('/:id/roles', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { roles } = req.body ?? {};

    if (!Array.isArray(roles)) {
      return res.status(400).json({ ok: false, error: 'roles must be an array' });
    }

    const updated = await userService.setRoles(id, roles);
    if (!updated) return res.status(404).json({ ok: false, error: 'user not found' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.user.roles.update',
      details: { userId: id, roles },
    });

    res.json({ ok: true, user: updated });
  } catch (err) {
    logger.error('admin.users.roles.update.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/users/:id/deactivate
 * Deactivate a user account
 */
router.post('/:id/deactivate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await userService.deactivate(id);
    if (!result) return res.status(404).json({ ok: false, error: 'user not found' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.user.deactivate',
      details: { userId: id },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('admin.users.deactivate.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/users/:id/activate
 * Reactivate a user account
 */
router.post('/:id/activate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await userService.activate(id);
    if (!result) return res.status(404).json({ ok: false, error: 'user not found' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.user.activate',
      details: { userId: id },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('admin.users.activate.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/users/:id/impersonate
 * Issue an admin-issued impersonation token for the given user.
 * Body: { ttlSeconds?: number } - optional TTL for the token
 */
router.post('/:id/impersonate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const ttlSeconds = Number(req.body?.ttlSeconds ?? 300); // default 5 minutes

    if (Number.isNaN(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 86400) {
      return res.status(400).json({ ok: false, error: 'invalid ttlSeconds' });
    }

    const token = await userService.createImpersonationToken(id, ttlSeconds);
    if (!token) return res.status(404).json({ ok: false, error: 'user not found or token creation failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.user.impersonate',
      details: { userId: id, ttlSeconds },
    });

    res.json({ ok: true, token });
  } catch (err) {
    logger.error('admin.users.impersonate.failed', { err });
    next(err);
  }
});

/**
 * DELETE /admin/users/:id
 * Hard delete a user (irreversible)
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const deleted = await userService.delete(id);
    if (!deleted) return res.status(404).json({ ok: false, error: 'user not found' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.user.delete',
      details: { userId: id },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('admin.users.delete.failed', { err });
    next(err);
  }
});

export default router;

