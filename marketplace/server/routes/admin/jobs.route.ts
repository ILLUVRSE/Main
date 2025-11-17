import express, { Request, Response, NextFunction } from 'express';
import logger from '../../lib/logger';
import auditWriter from '../../lib/auditWriter';
import { requireAdmin } from '../../middleware/adminAuth';
import jobService from '../../lib/jobService';

const router = express.Router();

// Require admin auth for all job routes
router.use(requireAdmin);

function parseListQuery(req: Request) {
  const q = (req.query.q as string) || '';
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 25)));
  const status = (req.query.status as string) || undefined; // e.g. pending, running, failed, succeeded
  const kind = (req.query.kind as string) || undefined;
  const worker = (req.query.worker as string) || undefined;
  return { q, page, limit, status, kind, worker };
}

/**
 * GET /admin/jobs
 * List background jobs with optional filtering and pagination
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, page, limit, status, kind, worker } = parseListQuery(req);

    const result = await jobService.listJobs({
      q,
      page,
      limit,
      status,
      kind,
      worker,
    });

    res.json({
      ok: true,
      items: result.items,
      meta: { total: result.total, page, limit },
    });
  } catch (err) {
    logger.error('admin.jobs.list.failed', { err });
    next(err);
  }
});

/**
 * GET /admin/jobs/:id
 * Fetch a single job with details and logs
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const job = await jobService.getJob(id, { includeLogs: true, includeHistory: true });
    if (!job) return res.status(404).json({ ok: false, error: 'job not found' });
    res.json({ ok: true, job });
  } catch (err) {
    logger.error('admin.jobs.get.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/jobs/:id/retry
 * Retry a failed or stalled job. Optional body: { attemptDelaySeconds?: number }
 */
router.post('/:id/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const attemptDelaySeconds = req.body?.attemptDelaySeconds ? Number(req.body.attemptDelaySeconds) : undefined;
    if (attemptDelaySeconds !== undefined && (Number.isNaN(attemptDelaySeconds) || attemptDelaySeconds < 0)) {
      return res.status(400).json({ ok: false, error: 'invalid attemptDelaySeconds' });
    }

    const retried = await jobService.retryJob(id, { attemptDelaySeconds, actor: (req as any).user?.id ?? 'admin' });
    if (!retried) return res.status(404).json({ ok: false, error: 'job not found or cannot retry' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.job.retry',
      details: { jobId: id, attemptDelaySeconds },
    });

    res.json({ ok: true, job: retried });
  } catch (err) {
    logger.error('admin.jobs.retry.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/jobs/:id/cancel
 * Cancel a running or pending job. Optional body: { reason?: string, force?: boolean }
 */
router.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const reason = (req.body?.reason as string) || '';
    const force = Boolean(req.body?.force ?? false);

    const cancelled = await jobService.cancelJob(id, { reason, force, actor: (req as any).user?.id ?? 'admin' });
    if (!cancelled) return res.status(404).json({ ok: false, error: 'job not found or cancel failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.job.cancel',
      details: { jobId: id, reason, force },
    });

    res.json({ ok: true, job: cancelled });
  } catch (err) {
    logger.error('admin.jobs.cancel.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/jobs/trigger
 * Trigger a one-off job by kind and payload.
 * body: { kind: string, payload?: object, priority?: number }
 */
router.post('/trigger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { kind, payload = {}, priority = 0 } = req.body ?? {};
    if (!kind || typeof kind !== 'string') {
      return res.status(400).json({ ok: false, error: 'kind is required' });
    }

    const job = await jobService.triggerJob({
      kind,
      payload,
      priority: Number(priority),
      initiatedBy: (req as any).user?.id ?? 'admin',
    });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.job.trigger',
      details: { jobId: job.id, kind, priority },
    });

    res.status(201).json({ ok: true, job });
  } catch (err) {
    logger.error('admin.jobs.trigger.failed', { err });
    next(err);
  }
});

/**
 * DELETE /admin/jobs/:id
 * Permanently remove a job record (administrative)
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const removed = await jobService.deleteJob(id, { actor: (req as any).user?.id ?? 'admin' });
    if (!removed) return res.status(404).json({ ok: false, error: 'job not found or delete failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.job.delete',
      details: { jobId: id },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('admin.jobs.delete.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/jobs/purge
 * Purge old jobs matching filters. body: { olderThanDays?: number, status?: string }
 */
router.post('/purge', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const olderThanDays = Number(req.body?.olderThanDays ?? 30);
    if (Number.isNaN(olderThanDays) || olderThanDays < 0) {
      return res.status(400).json({ ok: false, error: 'invalid olderThanDays' });
    }
    const status = (req.body?.status as string) || undefined;

    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const deletedCount = await jobService.purgeJobs({ cutoffIso: cutoff, status, actor: (req as any).user?.id ?? 'admin' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.job.purge',
      details: { olderThanDays, status, deletedCount },
    });

    res.json({ ok: true, deletedCount });
  } catch (err) {
    logger.error('admin.jobs.purge.failed', { err });
    next(err);
  }
});

/**
 * GET /admin/jobs/stats
 * Return job system statistics (counts by status, queue lengths, recent failures)
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await jobService.getStats();
    res.json({ ok: true, stats });
  } catch (err) {
    logger.error('admin.jobs.stats.failed', { err });
    next(err);
  }
});

export default router;

