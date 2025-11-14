import { InMemoryLedgerRepository } from '../../service/src/db/repository/ledgerRepository';
import { ReconciliationService } from '../../service/src/services/reconciliationService';
import { StripeAdapter } from '../../service/src/integrations/stripeAdapter';
import { PayoutProviderAdapter } from '../../service/src/integrations/payoutProviderAdapter';

describe('ReconciliationService', () => {
  it('generates report with zero mismatches for empty data', async () => {
    const repo = new InMemoryLedgerRepository();
    const service = new ReconciliationService(repo, new StripeAdapter('sk'), new PayoutProviderAdapter('https://payout'));
    const report = await service.reconcile('2024-01-01T00:00:00Z', '2024-01-01T01:00:00Z');
    expect(report.payoutMismatches).toHaveLength(0);
  });
});
