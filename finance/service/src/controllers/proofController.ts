import { Router } from 'express';
import { ProofService } from '../services/proofService';
import { ApprovalInput } from '../services/signingProxy';

export default function proofRouter(proofService: ProofService): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const { from, to, approvals, requiredRoles } = req.body as {
        from: string;
        to: string;
        approvals: ApprovalInput[];
        requiredRoles?: string[];
      };
      if (!from || !to || !Array.isArray(approvals)) {
        return res.status(400).json({ message: '`from`, `to`, and approvals[] are required' });
      }
      const proof = await proofService.buildProof(from, to, approvals, requiredRoles);
      res.status(201).json(proof);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:proofId', async (req, res, next) => {
    try {
      const manifest = await proofService.getProofManifest(req.params.proofId);
      if (!manifest) {
        return res.status(404).json({ message: 'Proof not found' });
      }
      res.json(manifest);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
