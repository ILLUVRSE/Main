import { LedgerRepository } from '../service/src/db/repository/ledgerRepository';
import { JournalEntry } from '../service/src/models/journalEntry';
import { Payout } from '../service/src/models/payout';

export class LedgerMock implements LedgerRepository {
  entries: JournalEntry[] = [];
  payouts = new Map<string, Payout>();

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async insertJournalEntries(entries: JournalEntry[]): Promise<void> {
    this.entries.push(...entries);
  }

  async recordPayout(payout: Payout): Promise<void> {
    this.payouts.set(payout.payoutId, payout);
  }

  async updatePayout(payoutId: string, patch: Partial<Payout>): Promise<void> {
    const payout = this.payouts.get(payoutId);
    if (!payout) throw new Error('Payout not found');
    this.payouts.set(payoutId, { ...payout, ...patch });
  }

  async fetchLedgerRange(from: string, to: string): Promise<JournalEntry[]> {
    return this.entries.filter((entry) => entry.timestamp >= from && entry.timestamp <= to);
  }

  async getPayout(payoutId: string): Promise<Payout | undefined> {
    return this.payouts.get(payoutId);
  }
}
