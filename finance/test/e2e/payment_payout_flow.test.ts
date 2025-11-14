import { InMemoryLedgerRepository } from '../../service/src/db/repository/ledgerRepository';
import { AuditService } from '../../service/src/audit/auditService';
import { LedgerService } from '../../service/src/services/ledgerService';
import { PayoutService } from '../../service/src/services/payoutService';
import { PayoutProviderAdapter } from '../../service/src/integrations/payoutProviderAdapter';

const repo = new InMemoryLedgerRepository();
const audit = new AuditService();
const ledgerService = new LedgerService(repo, audit);
const payoutService = new PayoutService(repo, audit, new PayoutProviderAdapter('https://payout'));

describe('payment+payout flow', () => {
  it('posts journal then approves payout', async () => {
    await ledgerService.postEntries(
      [
        {
          journalId: 'j1',
          batchId: 'b1',
          timestamp: new Date().toISOString(),
          currency: 'USD',
          lines: [
            { accountId: 'cash', direction: 'debit', amount: 100 },
            { accountId: 'revenue', direction: 'credit', amount: 100 },
          ],
        },
      ],
      'finance@example.com'
    );

    await payoutService.requestPayout(
      {
        payoutId: 'p1',
        amount: 100,
        currency: 'USD',
        destination: { provider: 'stripe', accountReference: 'acct_123' },
        memo: 'royalty',
        requestedBy: 'finance@example.com',
        status: 'pending_approval',
        approvals: [],
      },
      'finance@example.com'
    );

    const released = await payoutService.recordApproval('p1', {
      approver: 'finance@example.com',
      role: 'FinanceLead',
      signature: 'signed',
      approvedAt: new Date().toISOString(),
    });

    expect(released.status).toBe('awaiting_signatures');
  });
});
