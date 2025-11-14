import { ensureBalanced, JournalEntry } from '../../service/src/models/journalEntry';

describe('ensureBalanced', () => {
  it('passes when debits equal credits', () => {
    const entry: JournalEntry = {
      journalId: '1',
      batchId: 'b',
      timestamp: new Date().toISOString(),
      currency: 'USD',
      lines: [
        { accountId: 'cash', direction: 'debit', amount: 100 },
        { accountId: 'revenue', direction: 'credit', amount: 100 },
      ],
    };
    expect(() => ensureBalanced(entry)).not.toThrow();
  });

  it('throws when unbalanced', () => {
    const entry: JournalEntry = {
      journalId: '1',
      batchId: 'b',
      timestamp: new Date().toISOString(),
      currency: 'USD',
      lines: [
        { accountId: 'cash', direction: 'debit', amount: 100 },
        { accountId: 'revenue', direction: 'credit', amount: 50 },
      ],
    };
    expect(() => ensureBalanced(entry)).toThrow('unbalanced');
  });
});
