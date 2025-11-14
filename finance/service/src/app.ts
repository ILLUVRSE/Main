import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import { loadConfig } from './server/config';
import { InMemoryLedgerRepository } from './db/repository/ledgerRepository';
import { AuditService } from './audit/auditService';
import { LedgerService } from './services/ledgerService';
import { StripeAdapter } from './integrations/stripeAdapter';
import { PayoutProviderAdapter } from './integrations/payoutProviderAdapter';
import { ReconciliationService } from './services/reconciliationService';
import { SigningProxy } from './services/signingProxy';
import { ProofService } from './services/proofService';
import { PayoutService } from './services/payoutService';
import journalRouter from './controllers/journalController';
import payoutRouter from './controllers/payoutController';
import proofRouter from './controllers/proofController';
import payoutApprovalRouter from './controllers/payoutApprovalController';

const config = loadConfig();
const repo = new InMemoryLedgerRepository();
const auditService = new AuditService();
const ledgerService = new LedgerService(repo, auditService);
const stripeAdapter = new StripeAdapter(config.stripeKey);
const payoutAdapter = new PayoutProviderAdapter(config.payoutEndpoint);
new ReconciliationService(repo, stripeAdapter, payoutAdapter); // instantiated for completeness
const signingProxy = new SigningProxy(config.kmsEndpoint);
const proofService = new ProofService(repo, signingProxy);
const payoutService = new PayoutService(repo, auditService, payoutAdapter);

const app = express();
app.use(helmet());
app.use(bodyParser.json());
app.use((req, _res, next) => {
  if (config.tls.enabled && req.protocol !== 'https') {
    return next(new Error('TLS required'));
  }
  return next();
});

app.use('/finance/journal', journalRouter(ledgerService));
app.use('/finance/payout', payoutRouter(payoutService));
app.use('/finance/payout', payoutApprovalRouter(payoutService));
app.use('/finance/proof', proofRouter(proofService));

export default app;
