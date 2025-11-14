import { deterministicId } from '../../utils/deterministic.js';
import { FinanceEntry } from '../../types.js';

export class LedgerMock {
  constructor(private readonly ledgerId: string) {}

  record(amount: number, currency: string): FinanceEntry {
    const base = JSON.stringify({ ledgerId: this.ledgerId, amount, currency });
    return {
      entryId: deterministicId(base, 'fin'),
      ledgerId: this.ledgerId,
      credit: amount,
      debit: 0,
      currency,
    };
  }
}
