import express, { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';
import auditWriter from '../lib/auditWriter';
import paymentService from '../lib/paymentService';
import marketplaceService from '../lib/marketplaceService';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

// All routes here require authentication
router.use(requireAuth);

/**
 * GET /payments
 * List payments for the current authenticated user (buyer or seller)
 * Query: q, page, limit, status
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const q = (req.query.q as string) || '';
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25)));
    const status = (req.query.status as string) || undefined;

    const result = await paymentService.listPaymentsForUser(userId, { q, page, limit, status });

    res.json({ ok: true, items: result.items, meta: { total: result.total, page, limit } });
  } catch (err) {
    logger.error('payments.list.failed', { err });
    next(err);
  }
});

/**
 * GET /payments/:id
 * Get a single payment. Allowed for buyer, seller, or admin.
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const viewer = (req as any).user;

    const payment = await paymentService.getPaymentById(id);
    if (!payment) return res.status(404).json({ ok: false, error: 'payment not found' });

    // Authorization: buyer or seller or admin
    const isBuyer = payment.buyerId === viewer.id;
    const isSeller = payment.sellerId === viewer.id;
    const isAdmin = (viewer.roles || []).includes('admin');

    if (!isBuyer && !isSeller && !isAdmin) {
      return res.status(403).json({ ok: false, error: 'not authorized' });
    }

    res.json({ ok: true, payment });
  } catch (err) {
    logger.error('payments.get.failed', { err });
    next(err);
  }
});

/**
 * POST /payments/:id/cancel
 * Cancel a pending payment by the buyer.
 * body: { reason?: string }
 */
router.post('/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    const reason = (req.body?.reason as string) || '';

    const payment = await paymentService.getPaymentById(id);
    if (!payment) return res.status(404).json({ ok: false, error: 'payment not found' });

    if (payment.buyerId !== user.id) {
      return res.status(403).json({ ok: false, error: 'only the buyer can cancel this payment' });
    }

    const cancelled = await paymentService.cancelPayment(id, { reason, actor: user.id });
    if (!cancelled) return res.status(400).json({ ok: false, error: 'payment cannot be cancelled' });

    await auditWriter.write({
      actor: user.id,
      action: 'payment.cancel',
      details: { paymentId: id, reason },
    });

    res.json({ ok: true, payment: cancelled });
  } catch (err) {
    logger.error('payments.cancel.failed', { err });
    next(err);
  }
});

/**
 * POST /payments/:id/confirm
 * Confirm/complete an in-progress payment (e.g., complete a payment intent).
 * This is generally invoked by the buyer to finalize authentication-required payments.
 * body: { paymentMethodId?: string, returnUrl?: string }
 */
router.post('/:id/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    const { paymentMethodId, returnUrl } = req.body ?? {};

    const payment = await paymentService.getPaymentById(id);
    if (!payment) return res.status(404).json({ ok: false, error: 'payment not found' });

    if (payment.buyerId !== user.id) {
      return res.status(403).json({ ok: false, error: 'only the buyer can confirm this payment' });
    }

    // Delegate to paymentService to handle provider-specific confirmation flows.
    const confirmed = await paymentService.confirmPayment(id, { paymentMethodId, returnUrl, actor: user.id });
    if (!confirmed) return res.status(400).json({ ok: false, error: 'confirm failed' });

    await auditWriter.write({
      actor: user.id,
      action: 'payment.confirm',
      details: { paymentId: id },
    });

    res.json({ ok: true, payment: confirmed });
  } catch (err) {
    logger.error('payments.confirm.failed', { err });
    next(err);
  }
});

/**
 * POST /payments/:id/complete-download
 * Mark payment as completed and return a short-lived download entitlement/token for the buyer.
 * This endpoint ensures the buyer has completed payment and then returns a download token.
 */
router.post('/:id/complete-download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;

    const payment = await paymentService.getPaymentById(id);
    if (!payment) return res.status(404).json({ ok: false, error: 'payment not found' });

    if (payment.buyerId !== user.id) {
      return res.status(403).json({ ok: false, error: 'not authorized' });
    }

    if (!(payment.status === 'succeeded' || payment.status === 'completed')) {
      return res.status(400).json({ ok: false, error: 'payment not completed' });
    }

    // Ensure the listing still exists and prepare entitlement
    const listingId = payment.metadata?.listingId || payment.listingId;
    const listing = listingId ? await marketplaceService.getListing(listingId, { includeFiles: false }) : null;
    if (!listing) {
      // It's possible listing was removed; still allow download if payment contains archived file references.
      logger.warn('complete-download.listing.missing', { paymentId: id, listingId });
    }

    const token = await paymentService.createDownloadEntitlement(id, { actor: user.id, ttlSeconds: 300 });
    if (!token) return res.status(500).json({ ok: false, error: 'failed to create download token' });

    await auditWriter.write({
      actor: user.id,
      action: 'payment.download.entitle',
      details: { paymentId: id },
    });

    res.json({ ok: true, token });
  } catch (err) {
    logger.error('payments.complete-download.failed', { err });
    next(err);
  }
});

/**
 * POST /payments/:id/payout-request
 * Request a payout for a completed payment (seller-only).
 * body: { method?: string, destination?: string, note?: string }
 */
router.post('/:id/payout-request', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;
    const { method, destination, note } = req.body ?? {};

    const payment = await paymentService.getPaymentById(id);
    if (!payment) return res.status(404).json({ ok: false, error: 'payment not found' });

    if (payment.sellerId !== user.id) {
      return res.status(403).json({ ok: false, error: 'only the seller can request a payout' });
    }

    if (!(payment.status === 'succeeded' || payment.status === 'completed')) {
      return res.status(400).json({ ok: false, error: 'payment not eligible for payout' });
    }

    const payout = await paymentService.requestPayout(id, { method, destination, note, actor: user.id });
    if (!payout) return res.status(500).json({ ok: false, error: 'payout request failed' });

    await auditWriter.write({
      actor: user.id,
      action: 'payment.payout.request',
      details: { paymentId: id, payoutId: payout.id },
    });

    res.json({ ok: true, payout });
  } catch (err) {
    logger.error('payments.payout-request.failed', { err });
    next(err);
  }
});

/**
 * DELETE /payments/:id
 * Allow buyer to remove a failed or cancelled payment record from their view.
 * This does NOT refund or alter provider state.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const user = (req as any).user;

    const payment = await paymentService.getPaymentById(id);
    if (!payment) return res.status(404).json({ ok: false, error: 'payment not found' });

    // Only buyer can soft-delete their own payment (or admin)
    const isBuyer = payment.buyerId === user.id;
    const isAdmin = (user.roles || []).includes('admin');
    if (!isBuyer && !isAdmin) {
      return res.status(403).json({ ok: false, error: 'not authorized' });
    }

    const removed = await paymentService.softDeletePayment(id, { actor: user.id });
    if (!removed) return res.status(400).json({ ok: false, error: 'delete failed' });

    await auditWriter.write({
      actor: user.id,
      action: 'payment.delete',
      details: { paymentId: id },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('payments.delete.failed', { err });
    next(err);
  }
});

export default router;

