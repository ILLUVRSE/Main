import { Router } from 'express';
const normalizeRequest = (body) => ({
    version: String(body.version ?? ''),
    binaryHash: String(body.binaryHash ?? ''),
    notes: body.notes ? String(body.notes) : undefined,
    approvers: Array.isArray(body.approvers)
        ? body.approvers.map((approver) => String(approver))
        : [],
});
export const createMultisigRouter = (kernelClient) => {
    const router = Router();
    router.post('/upgrade', async (req, res, next) => {
        try {
            const payload = normalizeRequest(req.body);
            const result = await kernelClient.runMultisigUpgrade(payload);
            res.json(result);
        }
        catch (error) {
            next(error);
        }
    });
    return router;
};
