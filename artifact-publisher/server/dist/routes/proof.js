import { Router } from 'express';
export const createProofRouter = (proofService) => {
    const router = Router();
    router.post('/verify', (req, res) => {
        const proof = req.body.proof;
        const payload = req.body.payload;
        const valid = proofService.verifyProof(proof, payload);
        res.json({ valid });
    });
    return router;
};
