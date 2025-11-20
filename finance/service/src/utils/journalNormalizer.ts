import { randomUUID } from 'crypto';
import { JournalEntry, JournalLine } from '../models/journalEntry';
import { ValidationError } from './errors';

export type ApiJournalBody =
  | {
      journal_id?: string;
      batch_id?: string;
      timestamp?: string;
      currency?: string;
      context?: Record<string, string>;
      entries: Array<{
        account_id: string;
        side: 'debit' | 'credit';
        amount_cents: number;
        currency?: string;
        memo?: string;
      }>;
    }
  | JournalEntry[];

export function normalizeJournalRequest(payload: ApiJournalBody): JournalEntry[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || !Array.isArray(payload.entries) || payload.entries.length < 2) {
    throw new ValidationError('`entries` array with at least two lines is required');
  }
  const lines: JournalLine[] = payload.entries.map((line) => {
    if (!line.account_id || !line.side) {
      throw new ValidationError('Each entry must include account_id and side');
    }
    if (line.amount_cents <= 0) {
      throw new ValidationError('amount_cents must be positive');
    }
    return {
      accountId: line.account_id,
      direction: line.side,
      amount: line.amount_cents,
      memo: line.memo,
    };
  });
  const currency = payload.currency ?? payload.entries[0].currency;
  if (!currency) {
    throw new ValidationError('currency is required');
  }
  if (payload.entries.some((entry) => entry.currency && entry.currency !== currency)) {
    throw new ValidationError('All lines must share the same currency');
  }
  return [
    {
      journalId: payload.journal_id || randomUUID(),
      batchId: payload.batch_id || randomUUID(),
      timestamp: payload.timestamp || new Date().toISOString(),
      currency,
      metadata: payload.context,
      lines,
    },
  ];
}
