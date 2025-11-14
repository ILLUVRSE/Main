import { Router } from 'express';
import { KernelClient } from '../services/kernel/kernelClient.js';
import { MultisigUpgradeRequest } from '../types.js';

const normalizeRequest = (body: any): MultisigUpgradeRequest => ({
  version: String(body.version ?? ''),
  binaryHash: String(body.binaryHash ?? ''),
  notes: body.notes ? String(body.notes) : undefined,
  approvers: Array.isArray(body.approvers)
    ? body.approvers.map((approver: unknown) => String(approver))
    : [],
});

export const createMultisigRouter = (kernelClient: KernelClient) => {
  const router = Router();

  router.post('/upgrade', async (req, res, next) => {
    try {
      const payload = normalizeRequest(req.body);
      const result = await kernelClient.runMultisigUpgrade(payload);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
};
