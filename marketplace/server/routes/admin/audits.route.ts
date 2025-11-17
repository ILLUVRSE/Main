import express, { Request, Response, NextFunction } from 'express';
import { parse as parseUrl } from 'url';
import auditWriter from '../../lib/auditWriter';
import logger from '../../lib/logger';
import { requireAdmin } from '../../middleware/adminAuth';

const router = express.Router();

// All admin routes require admin auth
router.use(requireAdmin);

/**
 * Helper to parse list query params
 */
function parseListQuery(req: Request) {
  const q = (req.query.q as string) || '';
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 25)));
  const actor = (req.query.actor as string) || undefined;
  const action = (req.query.action as string) || undefined;
  const since = req.query.since ? new Date(String(req.query.since)) : undefined;
  const until = req.query.until ? new Date(String(req.query.until)) : undefined;

  return { q, page, limit, actor, action, since, until };
}

/**
 * GET /admin/audits
 * List / search audit events
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, page, limit, actor, action, since, until } = parseListQuery(req);

    const filter: any = {};
    if (q) filter.q = q;
    if (actor) filter.actor = actor;
    if (action) filter.action = action;
    if (since && !Number.isNaN(since.getTime())) filter.since = since.toISOString();
    if (until && !Number.isNaN(until.getTime())) filter.until = until.toISOString();

    const result = await auditWriter.query({
      page,
      limit,
      filter,
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
    logger.error('admin.audits.list.failed', { err });
    next(err);
  }
});

/**
 * GET /admin/audits/:id
 * Fetch a single audit record
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const entry = await auditWriter.getById(id);
    if (!entry) return res.status(404).json({ ok: false, error: 'audit entry not found' });
    res.json({ ok: true, entry });
  } catch (err) {
    logger.error('admin.audits.get.failed', { err });
    next(err);
  }
});

/**
 * DELETE /admin/audits/:id
 * Remove a single audit entry (irreversible)
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const deleted = await auditWriter.deleteById(id);
    if (!deleted) return res.status(404).json({ ok: false, error: 'audit entry not found' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.audit.delete',
      details: { auditId: id },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('admin.audits.delete.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/audits/export
 * Export audit entries (CSV) for a given filter.
 * Accepts same query params as listing endpoint (q, actor, action, since, until, limit)
 */
router.post('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, page = 1, limit = 1000, actor, action, since, until } = {
      ...parseListQuery(req),
      page: Number(req.query.page ?? 1),
      limit: Math.min(5000, Number(req.query.limit ?? 1000)),
    };

    const filter: any = {};
    if (q) filter.q = q;
    if (actor) filter.actor = actor;
    if (action) filter.action = action;
    if (since && !Number.isNaN(since.getTime())) filter.since = since.toISOString();
    if (until && !Number.isNaN(until.getTime())) filter.until = until.toISOString();

    // For exports we load up to `limit` entries (no pagination for export)
    const result = await auditWriter.query({
      page: 1,
      limit,
      filter,
    });

    // Build CSV
    const header = ['id', 'actor', 'action', 'details', 'createdAt'];
    const rows = result.items.map((it: any) => {
      const details = typeof it.details === 'string' ? it.details : JSON.stringify(it.details || {});
      // Escape quotes and newlines
      const escape = (v: string) => `"${String(v).replace(/"/g, '""').replace(/\n/g, '\\n')}"`;
      return [escape(it.id), escape(it.actor || ''), escape(it.action || ''), escape(details), escape(it.createdAt || '')].join(',');
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `marketplace-audits-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send([header.join(','), ...rows].join('\n'));
  } catch (err) {
    logger.error('admin.audits.export.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/audits/purge
 * Purge audit entries older than `olderThanDays` (body param).
 * body: { olderThanDays: number }
 */
router.post('/purge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { olderThanDays } = req.body ?? {};
    const days = Number(olderThanDays ?? 90);
    if (Number.isNaN(days) || days < 0) {
      return res.status(400).json({ ok: false, error: 'olderThanDays must be a positive number' });
    }

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const deletedCount = await auditWriter.purgeOlderThan(cutoff.toISOString());

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.audit.purge',
      details: { olderThanDays: days, deletedCount },
    });

    res.json({ ok: true, deletedCount });
  } catch (err) {
    logger.error('admin.audits.purge.failed', { err });
    next(err);
  }
});

export default router;

