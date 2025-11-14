import { Router } from 'express';
import { ProofService } from '../services/proofService';

export default function proofRouter(proofService: ProofService): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const { from, to } = req.query as { from: string; to: string };
      if (!from || !to) {
        return res.status(400).json({ message: '`from` and `to` query params are required' });
      }
      const approvals = [];
      const proof = await proofService.buildProof(from, to, approvals);
      res.json(proof);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
