import { Router } from 'express';
import { PayoutService } from '../services/payoutService';
import { Payout } from '../models/payout';

export default function payoutRouter(payoutService: PayoutService): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const payout: Payout = req.body;
      const actor = req.headers['x-user-email'] as string;
      const accepted = await payoutService.requestPayout({ ...payout, approvals: [] }, actor);
      res.status(202).json({ payoutId: accepted.payoutId, status: accepted.status });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
