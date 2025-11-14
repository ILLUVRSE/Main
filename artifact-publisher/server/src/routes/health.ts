import { Router } from 'express';
import { AppConfig } from '../config/env.js';
import { KernelClient } from '../services/kernel/kernelClient.js';

export const createHealthRouter = (config: AppConfig, kernelClient: KernelClient) => {
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
