// journal.ts

/**
 * Journal Entry Interface
 */
interface JournalEntry {
    id: string;
    amount: number;
    account: string;
    type: 'debit' | 'credit';
    timestamp: Date;
}

/**
 * Journal class to manage entries and ensure balance.
 */
class Journal {
    private entries: JournalEntry[] = [];

    public addEntry(entry: JournalEntry): void {
        this.entries.push(entry);
        this.reconcile();
    }

    private reconcile(): void {
        const balance = this.entries.reduce((acc, entry) => {
            return entry.type === 'debit' ? acc - entry.amount : acc + entry.amount;
        }, 0);
        if (balance !== 0) {
            throw new Error('Journal entries do not balance.');
        }
    }
}

export const journal = new Journal();