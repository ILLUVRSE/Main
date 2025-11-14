import { LedgerRepository } from '../db/repository/ledgerRepository';
import { StripeAdapter } from '../integrations/stripeAdapter';
import { PayoutProviderAdapter } from '../integrations/payoutProviderAdapter';
import { metrics } from '../monitoring/metrics';

export interface ReconciliationReport {
  from: string;
  to: string;
  ledgerEntries: number;
  stripeBalanceDelta: number;
  payoutMismatches: string[];
}

export class ReconciliationService {
  constructor(
    private repo: LedgerRepository,
    private stripe: StripeAdapter,
    private payoutProvider: PayoutProviderAdapter
  ) {}

  async reconcile(from: string, to: string): Promise<ReconciliationReport> {
    const ledgerEntries = await this.repo.fetchLedgerRange(from, to);
    const stripeBalance = await this.stripe.fetchBalance(from, to);
    const payoutReport = await this.payoutProvider.fetchSettlementReport(from, to);

    const payoutMismatches = payoutReport.filter((settlement) => !ledgerEntries.find((entry) => entry.metadata?.payoutId === settlement.payoutId)).map((s) => s.payoutId);

    const report = {
      from,
      to,
      ledgerEntries: ledgerEntries.length,
      stripeBalanceDelta: stripeBalance.delta,
      payoutMismatches,
    };
    metrics.observeReconciliation({ mismatches: payoutMismatches.length, windowSeconds: (Date.parse(to) - Date.parse(from)) / 1000 });
    return report;
  }
}
