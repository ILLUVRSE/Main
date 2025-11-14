import { LedgerRepository } from '../db/repository/ledgerRepository';
import { JournalEntry, ensureBalanced } from '../models/journalEntry';
import { AuditService } from '../audit/auditService';

export class LedgerService {
  constructor(private repo: LedgerRepository, private audit: AuditService) {}

  async postEntries(entries: JournalEntry[], actor: string): Promise<void> {
    entries.forEach(ensureBalanced);
    await this.repo.withTransaction(async () => {
      await this.repo.insertJournalEntries(entries);
      for (const entry of entries) {
        await this.audit.record({
          eventType: 'journal.posted',
          actor,
          subjectId: entry.journalId,
          payload: { currency: entry.currency, lines: entry.lines.length },
        });
      }
    });
  }
}
