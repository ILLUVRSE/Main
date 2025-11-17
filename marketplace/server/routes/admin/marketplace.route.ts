import express, { Request, Response, NextFunction } from 'express';
import logger from '../../lib/logger';
import auditWriter from '../../lib/auditWriter';
import { requireAdmin } from '../../middleware/adminAuth';
import marketplaceService from '../../lib/marketplaceService';

const router = express.Router();

// Require admin for all marketplace admin routes
router.use(requireAdmin);

/**
 * GET /admin/marketplace/listings
 * List marketplace listings with optional filters
 */
router.get('/listings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 25)));
    const status = (req.query.status as string) || undefined; // e.g., 'pending','published','rejected'
    const author = (req.query.author as string) || undefined;

    const result = await marketplaceService.listListings({
      q,
      page,
      limit,
      status,
      author,
    });

    res.json({
      ok: true,
      items: result.items,
      meta: { total: result.total, page, limit },
    });
  } catch (err) {
    logger.error('admin.marketplace.listings.failed', { err });
    next(err);
  }
});

/**
 * GET /admin/marketplace/listings/:id
 * Fetch a single listing with full metadata and audit trail
 */
router.get('/listings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const listing = await marketplaceService.getListing(id, { includeAudit: true });
    if (!listing) return res.status(404).json({ ok: false, error: 'listing not found' });
    res.json({ ok: true, listing });
  } catch (err) {
    logger.error('admin.marketplace.getListing.failed', { err });
    next(err);
  }
});

/**
 * PATCH /admin/marketplace/listings/:id
 * Update listing metadata (title, description, price, tags, visibility)
 */
router.patch('/listings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const allowed: any = {};
    const { title, description, price, tags, visibility } = req.body ?? {};

    if (typeof title === 'string') allowed.title = title;
    if (typeof description === 'string') allowed.description = description;
    if (typeof price !== 'undefined') {
      const p = Number(price);
      if (Number.isNaN(p) || p < 0) return res.status(400).json({ ok: false, error: 'invalid price' });
      allowed.price = p;
    }
    if (Array.isArray(tags)) allowed.tags = tags;
    if (typeof visibility === 'string') allowed.visibility = visibility; // e.g., 'public','private','unlisted'

    const updated = await marketplaceService.updateListing(id, allowed);
    if (!updated) return res.status(404).json({ ok: false, error: 'listing not found' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.marketplace.listing.update',
      details: { listingId: id, changes: Object.keys(allowed) },
    });

    res.json({ ok: true, listing: updated });
  } catch (err) {
    logger.error('admin.marketplace.updateListing.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/marketplace/listings/:id/approve
 * Approve a pending listing for publication
 * body: { message?: string }
 */
router.post('/listings/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const message = (req.body?.message as string) || '';

    const result = await marketplaceService.approveListing(id, {
      approvedBy: (req as any).user?.id ?? 'admin',
      message,
    });

    if (!result) return res.status(404).json({ ok: false, error: 'listing not found or not pending' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.marketplace.listing.approve',
      details: { listingId: id, message },
    });

    res.json({ ok: true, listing: result });
  } catch (err) {
    logger.error('admin.marketplace.approveListing.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/marketplace/listings/:id/reject
 * Reject a pending listing with optional reason
 * body: { reason?: string }
 */
router.post('/listings/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const reason = (req.body?.reason as string) || '';

    const result = await marketplaceService.rejectListing(id, {
      rejectedBy: (req as any).user?.id ?? 'admin',
      reason,
    });

    if (!result) return res.status(404).json({ ok: false, error: 'listing not found or not pending' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.marketplace.listing.reject',
      details: { listingId: id, reason },
    });

    res.json({ ok: true, listing: result });
  } catch (err) {
    logger.error('admin.marketplace.rejectListing.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/marketplace/listings/:id/publish
 * Force-publish a listing (bypassing approval checks)
 * body: { message?: string }
 */
router.post('/listings/:id/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const message = (req.body?.message as string) || '';

    const published = await marketplaceService.publishListing(id, {
      actor: (req as any).user?.id ?? 'admin',
      message,
    });

    if (!published) return res.status(404).json({ ok: false, error: 'listing not found or publish failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.marketplace.listing.publish',
      details: { listingId: id, message },
    });

    res.json({ ok: true, listing: published });
  } catch (err) {
    logger.error('admin.marketplace.publishListing.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/marketplace/listings/:id/unpublish
 * Unpublish a listing (take it down)
 * body: { reason?: string, removeFromSearch?: boolean }
 */
router.post('/listings/:id/unpublish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const reason = (req.body?.reason as string) || '';
    const removeFromSearch = Boolean(req.body?.removeFromSearch ?? true);

    const result = await marketplaceService.unpublishListing(id, {
      actor: (req as any).user?.id ?? 'admin',
      reason,
      removeFromSearch,
    });

    if (!result) return res.status(404).json({ ok: false, error: 'listing not found or unpublish failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.marketplace.listing.unpublish',
      details: { listingId: id, reason, removeFromSearch },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('admin.marketplace.unpublishListing.failed', { err });
    next(err);
  }
});

/**
 * DELETE /admin/marketplace/listings/:id
 * Permanently delete a listing (irreversible)
 */
router.delete('/listings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const removed = await marketplaceService.deleteListing(id);
    if (!removed) return res.status(404).json({ ok: false, error: 'listing not found' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.marketplace.listing.delete',
      details: { listingId: id },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('admin.marketplace.deleteListing.failed', { err });
    next(err);
  }
});

/**
 * GET /admin/marketplace/stats
 * Return marketplace statistics for admin dashboard
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await marketplaceService.getAdminStats();
    res.json({ ok: true, stats });
  } catch (err) {
    logger.error('admin.marketplace.stats.failed', { err });
    next(err);
  }
});

export default router;

