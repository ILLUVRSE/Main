import { Router } from 'express';
import { ProofService } from '../services/proof/proofService.js';
import { ProofRecord } from '../types.js';

export const createProofRouter = (proofService: ProofService) => {
  const router = Router();

  router.post('/verify', (req, res) => {
    const proof = req.body.proof as ProofRecord;
    const payload = req.body.payload;
    const valid = proofService.verifyProof(proof, payload);
    res.json({ valid });
  });

  return router;
};
