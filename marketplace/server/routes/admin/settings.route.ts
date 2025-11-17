import express, { Request, Response, NextFunction } from 'express';
import logger from '../../lib/logger';
import auditWriter from '../../lib/auditWriter';
import { requireAdmin } from '../../middleware/adminAuth';
import settingsService from '../../lib/settingsService';

const router = express.Router();

// Require admin for all settings routes
router.use(requireAdmin);

/**
 * Remove obvious secrets from an object before returning to clients.
 * We redact values for keys that match common secret patterns.
 */
function redactSecrets(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const cloned: any = Array.isArray(obj) ? [] : {};
  const secretPatterns = [/secret/i, /token/i, /key/i, /password/i, /private/i, /credential/i];

  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const isSecret = secretPatterns.some((rx) => rx.test(k));
    if (isSecret) {
      cloned[k] = '***REDACTED***';
      continue;
    }

    if (v && typeof v === 'object') {
      cloned[k] = redactSecrets(v);
    } else {
      cloned[k] = v;
    }
  }
  return cloned;
}

/**
 * GET /admin/settings
 * Returns full application settings with sensitive fields redacted.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await settingsService.getAll();
    res.json({ ok: true, settings: redactSecrets(settings) });
  } catch (err) {
    logger.error('admin.settings.get.failed', { err });
    next(err);
  }
});

/**
 * PATCH /admin/settings
 * Partially update runtime settings. Body must be an object with top-level keys to merge.
 *
 * NOTE: This endpoint does NOT accept raw secrets in responses — they will be redacted when returned.
 */
router.patch('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patch = req.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return res.status(400).json({ ok: false, error: 'invalid payload — expected object' });
    }

    const updated = await settingsService.update(patch);

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.settings.update',
      details: { changes: Object.keys(patch) },
    });

    res.json({ ok: true, settings: redactSecrets(updated) });
  } catch (err) {
    logger.error('admin.settings.update.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/settings/reload
 * Reload settings from the persistent store (disk / env / vault) into runtime.
 */
router.post('/reload', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reloaded = await settingsService.reload();
    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.settings.reload',
      details: {},
    });
    res.json({ ok: true, settings: redactSecrets(reloaded) });
  } catch (err) {
    logger.error('admin.settings.reload.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/settings/backup
 * Exports current settings as JSON for download. Sensitive fields are redacted in the export.
 */
router.post('/backup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await settingsService.getAll();
    const payload = JSON.stringify(redactSecrets(settings), null, 2);
    const filename = `illuvrse-settings-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.settings.backup',
      details: {},
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(payload);
  } catch (err) {
    logger.error('admin.settings.backup.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/settings/restore
 * Restore settings from provided JSON object in request body.
 * Body: { settings: object, force?: boolean }
 *
 * Force will apply changes even if they are potentially unsafe.
 */
router.post('/restore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.settings !== 'object') {
      return res.status(400).json({ ok: false, error: 'invalid payload — expected { settings: object }' });
    }

    const { settings, force = false } = body;

    // settingsService.restore should perform its own validation and refuse unsafe restores unless force is true
    const restored = await settingsService.restore(settings, { force: Boolean(force) });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.settings.restore',
      details: { force: Boolean(force) },
    });

    res.json({ ok: true, settings: redactSecrets(restored) });
  } catch (err: any) {
    logger.error('admin.settings.restore.failed', { err });
    // If settingsService throws a validation error return 400
    if (err && err.code === 'INVALID_SETTINGS') {
      return res.status(400).json({ ok: false, error: err.message });
    }
    next(err);
  }
});

/**
 * DELETE /admin/settings/cache
 * Clear any cached settings or derived runtime artifacts.
 */
router.delete('/cache', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await settingsService.clearCache();

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.settings.cache.clear',
      details: {},
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('admin.settings.cache.clear.failed', { err });
    next(err);
  }
});

export default router;

