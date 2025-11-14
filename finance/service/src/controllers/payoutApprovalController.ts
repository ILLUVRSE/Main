import { Router } from 'express';
import { PayoutService } from '../services/payoutService';
import { PayoutApproval } from '../models/payout';

export default function payoutApprovalRouter(payoutService: PayoutService): Router {
  const router = Router();

  router.post('/:payoutId/approvals', async (req, res, next) => {
    try {
      const { payoutId } = req.params;
      const approval: PayoutApproval = {
        ...req.body,
        approvedAt: new Date().toISOString(),
      };
      const updated = await payoutService.recordApproval(payoutId, approval);
      res.status(updated.status === 'released' ? 200 : 202).json({ payoutId, status: updated.status });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
