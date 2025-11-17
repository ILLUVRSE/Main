import express, { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';
import auditWriter from '../lib/auditWriter';
import marketplaceService from '../lib/marketplaceService';
import paymentService from '../lib/paymentService';
import userService from '../lib/userService';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

/**
 * Public listing search & browse
 * GET /marketplace/listings
 * Query: q, page, limit, tags, minPrice, maxPrice, sort, visibility
 */
router.get('/listings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const tags = req.query.tags ? String(req.query.tags).split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    const minPrice = typeof req.query.minPrice !== 'undefined' ? Number(req.query.minPrice) : undefined;
    const maxPrice = typeof req.query.maxPrice !== 'undefined' ? Number(req.query.maxPrice) : undefined;
    const sort = (req.query.sort as string) || 'relevance'; // relevance | newest | price_asc | price_desc
    const visibility = (req.query.visibility as string) || 'public';

    const result = await marketplaceService.searchListings({
      q,
      page,
      limit,
      tags,
      minPrice,
      maxPrice,
      sort,
      visibility,
    });

    res.json({ ok: true, items: result.items, meta: { total: result.total, page, limit } });
  } catch (err) {
    logger.error('marketplace.listings.list.failed', { err });
    next(err);
  }
});

/**
 * Get single listing (public)
 * GET /marketplace/listings/:id
 */
router.get('/listings/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const listing = await marketplaceService.getListing(id, { includeFiles: false });
    if (!listing) return res.status(404).json({ ok: false, error: 'listing not found' });

    // If listing is not public, ensure it's allowed
    if (listing.visibility !== 'public' && listing.visibility !== 'unlisted') {
      // Only show minimal metadata for non-public to unauthenticated users
      // If user is authenticated and owner/admin we can return full details
      const viewer = (req as any).user;
      if (!viewer || (viewer.id !== listing.authorId && !(viewer.roles || []).includes('admin'))) {
        return res.status(403).json({ ok: false, error: 'listing not available' });
      }
    }

    res.json({ ok: true, listing });
  } catch (err) {
    logger.error('marketplace.listings.get.failed', { err });
    next(err);
  }
});

/**
 * Create a listing
 * POST /marketplace/listings
 * Require authentication
 */
router.post('/listings', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    const authorId = (req as any).user.id;
    const allowed: any = {
      title: String(body.title || '').trim(),
      description: String(body.description || '').trim(),
      price: Number(body.price ?? 0),
      currency: String(body.currency || 'USD'),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      files: Array.isArray(body.files) ? body.files : [],
      visibility: String(body.visibility || 'private'),
      metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata : {},
    };

    if (!allowed.title) return res.status(400).json({ ok: false, error: 'title is required' });
    if (Number.isNaN(allowed.price) || allowed.price < 0) return res.status(400).json({ ok: false, error: 'invalid price' });

    const created = await marketplaceService.createListing({
      ...allowed,
      authorId,
    });

    await auditWriter.write({
      actor: authorId,
      action: 'marketplace.listing.create',
      details: { listingId: created.id, title: created.title },
    });

    res.status(201).json({ ok: true, listing: created });
  } catch (err) {
    logger.error('marketplace.listings.create.failed', { err });
    next(err);
  }
});

/**
 * Update a listing (owner or admin)
 * PATCH /marketplace/listings/:id
 */
router.patch('/listings/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const updater = (req as any).user;
    const listing = await marketplaceService.getListing(id, { includeFiles: false });
    if (!listing) return res.status(404).json({ ok: false, error: 'listing not found' });

    // Only owner or admin can edit
    if (listing.authorId !== updater.id && !((updater.roles || []).includes('admin'))) {
      return res.status(403).json({ ok: false, error: 'not authorized' });
    }

    const { title, description, price, currency, tags, visibility, metadata, files } = req.body ?? {};
    const changes: any = {};
    if (typeof title === 'string') changes.title = title.trim();
    if (typeof description === 'string') changes.description = description;
    if (typeof price !== 'undefined') {
      const p = Number(price);
      if (Number.isNaN(p) || p < 0) return res.status(400).json({ ok: false, error: 'invalid price' });
      changes.price = p;
    }
    if (typeof currency === 'string') changes.currency = currency;
    if (Array.isArray(tags)) changes.tags = tags.map(String);
    if (typeof visibility === 'string') changes.visibility = visibility;
    if (typeof metadata === 'object') changes.metadata = metadata;
    if (Array.isArray(files)) changes.files = files;

    const updated = await marketplaceService.updateListing(id, changes);
    if (!updated) return res.status(404).json({ ok: false, error: 'listing not found or update failed' });

    await auditWriter.write({
      actor: updater.id,
      action: 'marketplace.listing.update',
      details: { listingId: id, changes: Object.keys(changes) },
    });

    res.json({ ok: true, listing: updated });
  } catch (err) {
    logger.error('marketplace.listings.update.failed', { err });
    next(err);
  }
});

/**
 * Get current user's listings
 * GET /marketplace/me/listings
 */
router.get('/me/listings', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25)));

    const result = await marketplaceService.listByAuthor(userId, { page, limit });
    res.json({ ok: true, items: result.items, meta: { total: result.total, page, limit } });
  } catch (err) {
    logger.error('marketplace.me.listings.failed', { err });
    next(err);
  }
});

/**
 * Purchase a listing
 * POST /marketplace/listings/:id/purchase
 * Require auth
 * body: { paymentMethodId?: string, coupon?: string }
 */
router.post('/listings/:id/purchase', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const buyer = (req as any).user;
    const { paymentMethodId, coupon } = req.body ?? {};

    const listing = await marketplaceService.getListing(id, { includeFiles: false });
    if (!listing) return res.status(404).json({ ok: false, error: 'listing not found' });

    if (listing.authorId === buyer.id) {
      return res.status(400).json({ ok: false, error: 'cannot purchase your own listing' });
    }
    if (listing.visibility !== 'public' && listing.visibility !== 'unlisted') {
      return res.status(403).json({ ok: false, error: 'listing not available' });
    }

    // Create a payment intent / charge via paymentService
    const payment = await paymentService.createPaymentForListing({
      listingId: id,
      buyerId: buyer.id,
      sellerId: listing.authorId,
      amount: listing.price,
      currency: listing.currency || 'USD',
      paymentMethodId,
      coupon,
      metadata: { listingTitle: listing.title },
    });

    if (!payment) {
      return res.status(500).json({ ok: false, error: 'failed to create payment' });
    }

    await auditWriter.write({
      actor: buyer.id,
      action: 'marketplace.listing.purchase.initiated',
      details: { listingId: id, paymentId: payment.id },
    });

    res.status(201).json({ ok: true, payment });
  } catch (err) {
    logger.error('marketplace.listings.purchase.failed', { err });
    next(err);
  }
});

/**
 * Download purchased asset
 * GET /marketplace/listings/:id/download
 * Require auth - checks entitlements
 */
router.get('/listings/:id/download', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user.id;

    const listing = await marketplaceService.getListing(id, { includeFiles: true });
    if (!listing) return res.status(404).json({ ok: false, error: 'listing not found' });

    // Check entitlement: either free listing, owner, admin, or purchased
    const isOwner = listing.authorId === userId;
    const isAdmin = ((req as any).user.roles || []).includes('admin');
    const isFree = Number(listing.price ?? 0) === 0;

    let allowed = false;
    if (isOwner || isAdmin || isFree) allowed = true;
    else {
      const hasEntitlement = await marketplaceService.userHasPurchasedListing(userId, id);
      allowed = Boolean(hasEntitlement);
    }

    if (!allowed) return res.status(403).json({ ok: false, error: 'not entitled to download' });

    // marketplaceService.streamFileForListing should handle range requests / streaming
    const streamResult = await marketplaceService.streamListingFiles(id, { userId, res });

    if (!streamResult) {
      return res.status(500).json({ ok: false, error: 'failed to prepare download' });
    }

    // audit is handled by streamListingFiles or we still log
    await auditWriter.write({
      actor: userId,
      action: 'marketplace.listing.download',
      details: { listingId: id },
    });
    // the response is sent by marketplaceService via `res`
  } catch (err) {
    logger.error('marketplace.listings.download.failed', { err });
    next(err);
  }
});

/**
 * Get tags list
 * GET /marketplace/tags
 */
router.get('/tags', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || undefined;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const tags = await marketplaceService.listTags({ q, limit });
    res.json({ ok: true, tags });
  } catch (err) {
    logger.error('marketplace.tags.list.failed', { err });
    next(err);
  }
});

/**
 * Get listings by author
 * GET /marketplace/authors/:id/listings
 */
router.get('/authors/:id/listings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: authorId } = req.params;
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25)));

    const author = await userService.getById(authorId);
    if (!author) return res.status(404).json({ ok: false, error: 'author not found' });

    const result = await marketplaceService.listByAuthor(authorId, { page, limit });
    res.json({ ok: true, items: result.items, meta: { total: result.total, page, limit } });
  } catch (err) {
    logger.error('marketplace.authors.listings.failed', { err });
    next(err);
  }
});

export default router;

