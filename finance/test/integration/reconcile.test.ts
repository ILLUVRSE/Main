import { Pool } from 'pg';
import { ReconciliationService } from '../../service/src/services/reconciliationService';
import { StripeAdapter } from '../../service/src/integrations/stripeAdapter';
import { PayoutProviderAdapter } from '../../service/src/integrations/payoutProviderAdapter';
import { PostgresLedgerRepository } from '../../service/src/db/postgresLedgerRepository';
import { setupDatabase } from '../helpers/postgres';

describe('ReconciliationService', () => {
  let pool: Pool;
  let service: ReconciliationService;

  beforeAll(async () => {
    pool = await setupDatabase();
    const repo = new PostgresLedgerRepository({ pool });
    const stripe = new StripeAdapter({
      apiKey: process.env.STRIPE_API_KEY ?? 'sk_test_123',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test',
      apiBase: process.env.STRIPE_API_BASE ?? 'http://127.0.0.1:12111',
    });
    const payout = new PayoutProviderAdapter({ endpoint: process.env.PAYOUT_PROVIDER_ENDPOINT ?? 'http://127.0.0.1:4100' });
    service = new ReconciliationService(repo, stripe, payout);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('generates report with zero mismatches for empty data', async () => {
    const report = await service.reconcile('2024-01-01T00:00:00Z', '2024-01-01T01:00:00Z');
    expect(report.payoutMismatches).toHaveLength(0);
  });
});
