import { LedgerRepository } from '../db/repository/ledgerRepository';
import { JournalEntry, ensureBalanced } from '../models/journalEntry';
import { AuditService } from '../audit/auditService';
import { metrics } from '../monitoring/metrics';
import { canonicalJson } from '../utils/canonicalize';
import { IdempotencyConflictError } from '../utils/errors';

export interface PostOptions {
  idempotencyKey?: string;
}

export class LedgerService {
  constructor(private repo: LedgerRepository, private audit: AuditService) {}

  async postEntries(entries: JournalEntry[], actor: string, options: PostOptions = {}): Promise<JournalEntry[]> {
    if (!entries.length) throw new Error('No journal entries supplied');
    entries.forEach(ensureBalanced);
    const payloadHash = canonicalJson(entries);
    if (options.idempotencyKey) {
      const existing = await this.repo.findIdempotentRequest(options.idempotencyKey);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new IdempotencyConflictError('Idempotency key payload mismatch');
        }
        if (existing.journalIds.length) {
          const journals = await Promise.all(existing.journalIds.map((id) => this.repo.fetchJournal(id)));
          return journals.filter((j): j is JournalEntry => Boolean(j));
        }
      }
    }

    await this.repo.withTransaction(async () => {
      await this.repo.insertJournalEntries(entries);
      if (options.idempotencyKey) {
        try {
          await this.repo.recordIdempotentRequest(
            options.idempotencyKey,
            payloadHash,
            entries.map((entry) => entry.journalId),
            actor
          );
        } catch (error) {
          if ((error as Error).message === 'IDEMPOTENCY_KEY_MISMATCH') {
            throw new IdempotencyConflictError('Idempotency key payload mismatch');
          }
          throw error;
        }
      }
      for (const entry of entries) {
        await this.audit.record({
          eventType: 'journal.posted',
          actor,
          subjectId: entry.journalId,
          payload: { currency: entry.currency, lines: entry.lines.length },
        });
      }
    });
    metrics.observeJournalEntries(entries.length);
    return entries;
  }

  async getJournal(journalId: string): Promise<JournalEntry | undefined> {
    return this.repo.fetchJournal(journalId);
  }
}
