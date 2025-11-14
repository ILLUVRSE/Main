import { Router } from 'express';
import { PayoutService } from '../services/payoutService';
import { PayoutApproval } from '../models/payout';

export default function payoutApprovalRouter(payoutService: PayoutService): Router {
  const router = Router();

  router.post('/:payoutId/approvals', async (req, res, next) => {
    try {
      const { payoutId } = req.params;
      const actor = (req.headers['x-user-email'] as string) || req.body.approver;
      const approval: PayoutApproval = {
        ...req.body,
        approver: actor,
        approvedAt: new Date().toISOString(),
      };
      const updated = await payoutService.recordApproval(payoutId, approval);
      res.status(updated.status === 'released' ? 200 : 202).json({ payoutId, status: updated.status });
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return res.status(404).json({ message: (error as Error).message });
      }
      next(error);
    }
  });

  return router;
}
