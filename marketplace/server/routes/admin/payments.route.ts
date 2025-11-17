import express, { Request, Response, NextFunction } from 'express';
import logger from '../../lib/logger';
import auditWriter from '../../lib/auditWriter';
import { requireAdmin } from '../../middleware/adminAuth';
import paymentService from '../../lib/paymentService';

const router = express.Router();

// All admin payment routes require admin auth
router.use(requireAdmin);

/**
 * GET /admin/payments
 * List payments with optional filters: q, page, limit, status, userId, method
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 25)));
    const status = (req.query.status as string) || undefined;
    const userId = (req.query.userId as string) || undefined;
    const method = (req.query.method as string) || undefined;

    const result = await paymentService.listPayments({
      q,
      page,
      limit,
      status,
      userId,
      method,
    });

    res.json({
      ok: true,
      items: result.items,
      meta: { total: result.total, page, limit },
    });
  } catch (err) {
    logger.error('admin.payments.list.failed', { err });
    next(err);
  }
});

/**
 * GET /admin/payments/:id
 * Get a single payment record
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const payment = await paymentService.getPaymentById(id);
    if (!payment) return res.status(404).json({ ok: false, error: 'payment not found' });
    res.json({ ok: true, payment });
  } catch (err) {
    logger.error('admin.payments.get.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/payments/:id/refund
 * Refund a payment (full or partial)
 * body: { amount?: number, currency?: string, reason?: string }
 */
router.post('/:id/refund', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const amount = typeof req.body?.amount !== 'undefined' ? Number(req.body.amount) : undefined;
    const currency = (req.body?.currency as string) || undefined;
    const reason = (req.body?.reason as string) || '';

    if (amount !== undefined && (Number.isNaN(amount) || amount <= 0)) {
      return res.status(400).json({ ok: false, error: 'invalid amount' });
    }

    const refund = await paymentService.refundPayment(id, { amount, currency, reason, initiatedBy: (req as any).user?.id ?? 'admin' });

    if (!refund) return res.status(404).json({ ok: false, error: 'payment not found or refund failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.payment.refund',
      details: { paymentId: id, amount, currency, reason },
    });

    res.json({ ok: true, refund });
  } catch (err) {
    logger.error('admin.payments.refund.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/payments/:id/settle
 * Force-settle a pending payment (manual intervention)
 * body: { note?: string }
 */
router.post('/:id/settle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const note = (req.body?.note as string) || '';

    const settled = await paymentService.settlePayment(id, { note, actor: (req as any).user?.id ?? 'admin' });
    if (!settled) return res.status(404).json({ ok: false, error: 'payment not found or settle failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.payment.settle',
      details: { paymentId: id, note },
    });

    res.json({ ok: true, payment: settled });
  } catch (err) {
    logger.error('admin.payments.settle.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/payments/:id/retry
 * Retry a failed capture or charge
 * body: { reason?: string }
 */
router.post('/:id/retry', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const reason = (req.body?.reason as string) || '';

    const retried = await paymentService.retryPayment(id, { reason, actor: (req as any).user?.id ?? 'admin' });
    if (!retried) return res.status(404).json({ ok: false, error: 'payment not found or retry failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.payment.retry',
      details: { paymentId: id, reason },
    });

    res.json({ ok: true, payment: retried });
  } catch (err) {
    logger.error('admin.payments.retry.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/payments/:id/payout
 * Trigger a payout for a completed payment to a seller/recipient
 * body: { method?: string, destination?: string, note?: string }
 */
router.post('/:id/payout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const method = (req.body?.method as string) || undefined;
    const destination = (req.body?.destination as string) || undefined;
    const note = (req.body?.note as string) || '';

    const payout = await paymentService.createPayout(id, { method, destination, note, actor: (req as any).user?.id ?? 'admin' });
    if (!payout) return res.status(404).json({ ok: false, error: 'payment not found or payout failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.payment.payout',
      details: { paymentId: id, method, destination },
    });

    res.json({ ok: true, payout });
  } catch (err) {
    logger.error('admin.payments.payout.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/payments/:id/hold
 * Place a manual hold on a payment
 * body: { reason?: string }
 */
router.post('/:id/hold', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const reason = (req.body?.reason as string) || '';

    const held = await paymentService.holdPayment(id, { reason, actor: (req as any).user?.id ?? 'admin' });
    if (!held) return res.status(404).json({ ok: false, error: 'payment not found or hold failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.payment.hold',
      details: { paymentId: id, reason },
    });

    res.json({ ok: true, payment: held });
  } catch (err) {
    logger.error('admin.payments.hold.failed', { err });
    next(err);
  }
});

/**
 * POST /admin/payments/:id/release
 * Release a previously placed hold
 * body: { reason?: string }
 */
router.post('/:id/release', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const reason = (req.body?.reason as string) || '';

    const released = await paymentService.releaseHold(id, { reason, actor: (req as any).user?.id ?? 'admin' });
    if (!released) return res.status(404).json({ ok: false, error: 'payment not found or release failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.payment.release',
      details: { paymentId: id, reason },
    });

    res.json({ ok: true, payment: released });
  } catch (err) {
    logger.error('admin.payments.release.failed', { err });
    next(err);
  }
});

/**
 * DELETE /admin/payments/:id
 * Permanently remove a payment record (administrative; irreversible)
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const removed = await paymentService.deletePayment(id, { actor: (req as any).user?.id ?? 'admin' });
    if (!removed) return res.status(404).json({ ok: false, error: 'payment not found or delete failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.payment.delete',
      details: { paymentId: id },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('admin.payments.delete.failed', { err });
    next(err);
  }
});

export default router;

