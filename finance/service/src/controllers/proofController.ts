import { Router } from 'express';
import { ProofService } from '../services/proofService';
import { ApprovalInput } from '../services/signingProxy';

export default function proofRouter(proofService: ProofService): Router {
  const router = Router();

  const handleGenerate = async (req: any, res: any, next: any) => {
    try {
      const { from, to, approvals, requiredRoles } = req.body as {
        from: string;
        to: string;
        approvals: ApprovalInput[];
        requiredRoles?: string[];
      };
      if (!from || !to || !Array.isArray(approvals)) {
        return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: '`from`, `to`, and approvals[] are required' } });
      }
      const proof = await proofService.buildProof(from, to, approvals, requiredRoles);
      res.status(201).json({ ok: true, proof_id: proof.proofId, proof });
    } catch (err) {
      next(err);
    }
  };

  router.post('/', handleGenerate);
  router.post('/generate', handleGenerate);

  router.get('/:proofId', async (req, res, next) => {
    try {
      const manifest = await proofService.getProofManifest(req.params.proofId);
      if (!manifest) {
        return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Proof not found' } });
      }
      res.json({ ok: true, proof: manifest });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
