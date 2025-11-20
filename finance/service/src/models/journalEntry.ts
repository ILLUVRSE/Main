export type Direction = 'debit' | 'credit';

export interface JournalLine {
  accountId: string;
  direction: Direction;
  amount: number; // stored as cents for precision
  memo?: string;
}

export interface JournalEntry {
  journalId: string;
  batchId: string;
  timestamp: string; // ISO-8601
  currency: string;
  lines: JournalLine[];
  metadata?: Record<string, unknown>;
}

export function ensureBalanced(entry: JournalEntry): void {
  const totals = entry.lines.reduce(
    (acc, line) => {
      if (line.direction === 'debit') acc.debits += line.amount;
      else acc.credits += line.amount;
      return acc;
    },
    { debits: 0, credits: 0 }
  );

  if (totals.debits !== totals.credits) {
    throw new Error(`Journal entry ${entry.journalId} is unbalanced: ${totals.debits} != ${totals.credits}`);
  }
}
