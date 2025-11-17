import express, { Request, Response, NextFunction } from 'express';
import logger from '../../lib/logger';
import auditWriter from '../../lib/auditWriter';
import { requireAdmin } from '../../middleware/adminAuth';
import integrationService from '../../lib/integrationService';

const router = express.Router();

// Require admin for all integration admin routes
router.use(requireAdmin);

/**
 * GET /admin/integrations
 * List integrations with optional filters
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 25)));
    const kind = (req.query.kind as string) || undefined; // e.g., 'stripe','github','s3'
    const activeParam = req.query.active;
    const active =
      typeof activeParam === 'string' ? (activeParam === 'true' ? true : activeParam === 'false' ? false : undefined) : undefined;

    const result = await integrationService.list({
      q,
      page,
      limit,
      kind,
      active,
    });

    res.json({
      ok: true,
      items: result.items,
      meta: { total: result.total, page, limit },
    });
  } catch (err) {
    logger.error('admin.integrations.list.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/integrations
 * Create a new integration
 * body: { name: string, kind: string, config: object, active?: boolean }
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, kind, config = {}, active = true } = req.body ?? {};

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }
    if (!kind || typeof kind !== 'string') {
      return res.status(400).json({ ok: false, error: 'kind is required' });
    }
    if (typeof config !== 'object') {
      return res.status(400).json({ ok: false, error: 'config must be an object' });
    }

    const created = await integrationService.create({
      name,
      kind,
      config,
      active: Boolean(active),
      createdBy: (req as any).user?.id ?? 'admin',
    });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.integration.create',
      details: { integrationId: created.id, name, kind },
    });

    res.status(201).json({ ok: true, integration: created });
  } catch (err) {
    logger.error('admin.integrations.create.failed', { err });
    next(err);
  }
});

/**
 * GET /admin/integrations/:id
 * Get a single integration (redacts secrets)
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const integration = await integrationService.getById(id);
    if (!integration) return res.status(404).json({ ok: false, error: 'integration not found' });

    // Service should redact secrets for safety, but ensure we never leak raw secrets.
    const safe = integrationService.redact(integration);
    res.json({ ok: true, integration: safe });
  } catch (err) {
    logger.error('admin.integrations.get.failed', { err });
    next(err);
  }
});

/**
 * PATCH /admin/integrations/:id
 * Update integration metadata or config
 * body: { name?: string, config?: object, active?: boolean }
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, config, active } = req.body ?? {};

    const changes: any = {};
    if (typeof name === 'string') changes.name = name;
    if (typeof config === 'object') changes.config = config;
    if (typeof active !== 'undefined') changes.active = Boolean(active);

    if (Object.keys(changes).length === 0) {
      return res.status(400).json({ ok: false, error: 'no changes provided' });
    }

    const updated = await integrationService.update(id, changes);
    if (!updated) return res.status(404).json({ ok: false, error: 'integration not found' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.integration.update',
      details: { integrationId: id, changes: Object.keys(changes) },
    });

    res.json({ ok: true, integration: integrationService.redact(updated) });
  } catch (err) {
    logger.error('admin.integrations.update.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/integrations/:id/test
 * Test an integration's connectivity and configuration.
 * body: { dryRun?: boolean }
 */
router.post('/:id/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const dryRun = Boolean(req.body?.dryRun ?? true);

    const integration = await integrationService.getById(id);
    if (!integration) return res.status(404).json({ ok: false, error: 'integration not found' });

    const report = await integrationService.testConnection(id, { dryRun });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.integration.test',
      details: { integrationId: id, success: Boolean(report?.ok) },
    });

    res.json({ ok: true, report });
  } catch (err) {
    logger.error('admin.integrations.test.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/integrations/:id/reload
 * Reload integration configuration at runtime
 */
router.post('/:id/reload', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const reloaded = await integrationService.reload(id);
    if (!reloaded) return res.status(404).json({ ok: false, error: 'integration not found or reload failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.integration.reload',
      details: { integrationId: id },
    });

    res.json({ ok: true, integration: integrationService.redact(reloaded) });
  } catch (err) {
    logger.error('admin.integrations.reload.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/integrations/sync
 * Trigger a sync across integrations (optionally only specific kinds)
 * body: { kinds?: string[], force?: boolean }
 */
router.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kinds = Array.isArray(req.body?.kinds) ? req.body.kinds.map(String) : undefined;
    const force = Boolean(req.body?.force ?? false);

    const job = await integrationService.triggerSync({ kinds, force, initiatedBy: (req as any).user?.id ?? 'admin' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.integration.sync',
      details: { kinds, force, jobId: job?.id },
    });

    res.json({ ok: true, job });
  } catch (err) {
    logger.error('admin.integrations.sync.failed', { err });
    next(err);
  }
});

/**
 * DELETE /admin/integrations/:id
 * Permanently remove an integration configuration
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const removed = await integrationService.delete(id);
    if (!removed) return res.status(404).json({ ok: false, error: 'integration not found or delete failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.integration.delete',
      details: { integrationId: id },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('admin.integrations.delete.failed', { err });
    next(err);
  }
});

export default router;

