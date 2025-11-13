// kernel.ts

import express from 'express';
import { signManifest } from '../kernel/sign';

const router = express.Router();

router.post('/sign', async (req, res) => {
    const { manifest } = req.body;
    const { signedManifest, signature } = await signManifest(manifest);
    res.json({ signedManifest, signature });
});

export default router;