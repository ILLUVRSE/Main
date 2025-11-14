import { Router } from 'express';
export const createHealthRouter = (config, kernelClient) => {
    const router = Router();
    router.get('/', async (_req, res) => {
        const kernelHealthy = await kernelClient.health().catch(() => false);
        res.json({
            service: 'artifact-publisher',
            status: 'ok',
            kernelHealthy,
            port: config.port,
        });
    });
    return router;
};
