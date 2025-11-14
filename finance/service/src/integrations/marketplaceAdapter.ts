import { JournalEntry } from '../models/journalEntry';
import { deterministicId } from '../utils/deterministicId';

export class MarketplaceAdapter {
  mapOrderToJournal(order: { orderId: string; amount: number; currency: string }): JournalEntry {
    const journalId = deterministicId(order.orderId);
    return {
      journalId,
      batchId: deterministicId(`${order.orderId}:batch`),
      timestamp: new Date().toISOString(),
      currency: order.currency,
      lines: [
        { accountId: 'cash', direction: 'debit', amount: order.amount },
        { accountId: 'revenue', direction: 'credit', amount: order.amount },
      ],
      metadata: { source: 'marketplace', orderId: order.orderId },
    };
  }
}
