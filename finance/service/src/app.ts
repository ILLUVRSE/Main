import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import { loadConfig } from './server/config';
import { InMemoryLedgerRepository } from './db/repository/ledgerRepository';
import { PostgresLedgerRepository } from './db/postgresLedgerRepository';
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

const nodeEnv = process.env.NODE_ENV ?? 'development';
const requireKms = String(process.env.REQUIRE_KMS ?? '').toLowerCase() === 'true';
if (nodeEnv === 'production' && String(process.env.DEV_SKIP_MTLS ?? '').toLowerCase() === 'true') {
  // mTLS is mandatory in prod; bail fast to avoid accidental insecure runs.
  throw new Error('DEV_SKIP_MTLS=true is forbidden in production');
}
if (nodeEnv === 'production' || requireKms) {
  const kmsConfigured = Boolean(process.env.KMS_ENDPOINT || process.env.FINANCE_KMS_ENDPOINT || process.env.KMS_KEY_ID || process.env.AWS_KMS_KEY_ID);
  if (!kmsConfigured) {
    throw new Error('KMS configuration required in production (set FINANCE_KMS_ENDPOINT/KMS_ENDPOINT + key id)');
  }
}

const config = loadConfig();
const repo =
  config.ledgerRepo === 'postgres'
    ? new PostgresLedgerRepository(config.databaseUrl)
    : new InMemoryLedgerRepository();
const auditService = new AuditService();
const ledgerService = new LedgerService(repo, auditService);
const stripeAdapter = new StripeAdapter({
  apiKey: config.stripe.apiKey,
  webhookSecret: config.stripe.webhookSecret,
  apiBase: config.stripe.apiBase,
});
const payoutAdapter = new PayoutProviderAdapter({ endpoint: config.payout.endpoint, authToken: config.payout.authToken });
new ReconciliationService(repo, stripeAdapter, payoutAdapter); // instantiated for completeness
const signingProxy = new SigningProxy({
  region: config.awsRegion,
  endpoint: config.kmsEndpoint,
  keyId: config.kmsKeyId,
});
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
