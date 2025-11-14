import express from 'express';
import cors from 'cors';
import { resolveConfig, AppConfig } from './config/env.js';
import { createHealthRouter } from './routes/health.js';
import { createCheckoutRouter } from './routes/checkout.js';
import { createProofRouter } from './routes/proof.js';
import { createMultisigRouter } from './routes/multisig.js';
import { createSandboxRouter } from './routes/sandbox.js';
import { StripeMock } from './services/payment/stripeMock.js';
import { LedgerMock } from './services/finance/ledgerMock.js';
import { ProofService } from './services/proof/proofService.js';
import { LicenseService } from './services/license/licenseService.js';
import { DeliveryService } from './services/delivery/deliveryService.js';
import { KernelClient } from './services/kernel/kernelClient.js';
import { CheckoutService } from './services/checkoutService.js';
import { OrderRepository } from './repository/orderRepository.js';
import { SandboxRunner } from './services/sandbox/sandboxRunner.js';

export const createApplication = (overrides: Partial<AppConfig> = {}) => {
  const config = resolveConfig(overrides);
  const kernelClient = new KernelClient(config.kernel.baseUrl);
  const proofService = new ProofService(config.proofSecret);
  const checkoutService = new CheckoutService(
    new StripeMock(config.stripePublicKey),
    new LedgerMock(config.financeLedgerId),
    proofService,
    new LicenseService(),
    new DeliveryService(config.deliveryKey),
    kernelClient,
    new OrderRepository(),
    config.deterministicSalt,
  );

  const sandboxRunner = new SandboxRunner(config.sandboxSeed);

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/health', createHealthRouter(config, kernelClient));
  app.use('/api/checkout', createCheckoutRouter(checkoutService));
  app.use('/api/proof', createProofRouter(proofService));
  app.use('/api/multisig', createMultisigRouter(kernelClient));
  app.use('/api/sandbox', createSandboxRouter(sandboxRunner));

  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({ message: error.message });
    },
  );

  return { app, config, services: { checkoutService, proofService, sandboxRunner } };
};
