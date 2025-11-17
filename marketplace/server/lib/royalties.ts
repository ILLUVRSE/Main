/**
 * marketplace/server/lib/royalties.ts
 *
 * Functions:
 *  - computeRoyaltiesForSku(skuId, amountCents)
 *      -> { totalRoyalties: number, splits: Array<{ recipient: string, amount: number }> }
 *
 *  - mapOrderToJournal(order)
 *      -> JournalEntry {
 *           journalId, batchId, timestamp, currency, lines: [{ accountId, direction, amount }, ...], metadata
 *         }
 *
 * Notes:
 *  - Royalties table expected to contain JSON rule as in migrations:
 *      { "type": "percentage", "splits": [ { "recipient": "actor:alice", "percentage": 10 }, ... ] }
 *  - Percentages are applied to amountCents and amounts are floored to integers
 *  - Any rounding remainder is assigned to account `platform:illuvrse` to keep totals balanced
 *  - If DB not available, defaults to no royalties (empty splits)
 */

import crypto from 'crypto';

type RoyaltySplit = {
  recipient: string;
  amount: number; // integer cents
};

type RoyaltyResult = {
  totalRoyalties: number;
  splits: RoyaltySplit[];
};

type JournalLine = {
  accountId: string;
  direction: 'debit' | 'credit';
  amount: number; // integer cents
};

type JournalEntry = {
  journalId: string;
  batchId: string;
  timestamp: string;
  currency: string;
  lines: JournalLine[];
  metadata?: any;
};

/**
 * Try to load DB helper (server/lib/db)
 */
function getDb(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dbMod = require('./db');
    return dbMod && (dbMod.default || dbMod);
  } catch {
    return null;
  }
}

/**
 * Compute royalties for a SKU given an integer amount (cents).
 * Returns totalRoyalties and splits array.
 */
export async function computeRoyaltiesForSku(skuId: string, amountCents: number): Promise<RoyaltyResult> {
  if (!skuId) {
    return { totalRoyalties: 0, splits: [] };
  }

  // Try to read royalty rule from DB
  try {
    const db = getDb();
    if (db && typeof db.query === 'function') {
      const r = await db.query('SELECT rule FROM royalties WHERE sku_id = $1 ORDER BY created_at DESC LIMIT 1', [skuId]);
      if (r && r.rows && r.rows.length > 0) {
        const rule = r.rows[0].rule;
        // Expect rule.type === 'percentage' and rule.splits = [{ recipient, percentage }]
        if (rule && rule.type === 'percentage' && Array.isArray(rule.splits)) {
          const splitsRaw: any[] = rule.splits;
          const splits: RoyaltySplit[] = [];
          let totalAllocated = 0;

          for (const s of splitsRaw) {
            const recipient = String(s.recipient || s.to || '').trim();
            const percentage = Number(s.percentage || s.percent || s.pct || 0);
            if (!recipient || !Number.isFinite(percentage) || percentage <= 0) continue;
            const amt = Math.floor((amountCents * percentage) / 100);
            splits.push({ recipient, amount: amt });
            totalAllocated += amt;
          }

          // Remainder due to flooring
          const remainder = amountCents - totalAllocated;
          if (remainder > 0) {
            // Assign remainder to platform account to keep totals balanced
            splits.push({ recipient: 'platform:illuvrse', amount: remainder });
            return { totalRoyalties: totalAllocated + remainder, splits };
          } else {
            return { totalRoyalties: totalAllocated, splits };
          }
        }
      }
    }
  } catch (e) {
    // ignore DB errors and fall through to no-royalty
    // eslint-disable-next-line no-console
    console.debug('computeRoyaltiesForSku DB read failed:', (e as Error).message);
  }

  // No royalty rule found or DB not available -> no royalties
  return { totalRoyalties: 0, splits: [] };
}

/**
 * Generate deterministic id from a string (sha256 hex cut)
 */
function shortDeterministicId(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Create a JournalEntry for an order (expected order shape minimally):
 * {
 *   order_id, sku_id, amount (cents), currency, buyer_id
 * }
 *
 * Behavior:
 *  - Debit 'cash' by full amount
 *  - Credit 'revenue' by (amount - totalRoyalties)
 *  - For each royalty split, credit an account `royalty:<recipient>` by its amount
 *  - Journal metadata includes source: 'marketplace', orderId, skuId
 */
export async function mapOrderToJournal(order: any): Promise<JournalEntry> {
  if (!order || !order.order_id || !Number.isFinite(Number(order.amount))) {
    throw new Error('order must include order_id and numeric amount');
  }

  const orderId: string = String(order.order_id);
  const skuId: string = String(order.sku_id || 'unknown-sku');
  const amountCents: number = Number(order.amount || 0);
  const currency: string = String(order.currency || 'USD');

  // Compute royalties
  const royaltyResult = await computeRoyaltiesForSku(skuId, amountCents);
  const totalRoyalties = royaltyResult.totalRoyalties || 0;

  // Compose lines
  const lines: JournalLine[] = [];

  // Debit cash
  lines.push({ accountId: 'cash', direction: 'debit', amount: amountCents });

  // Credit revenue for remainder after royalties
  const revenueAmount = Math.max(0, amountCents - totalRoyalties);
  lines.push({ accountId: 'revenue', direction: 'credit', amount: revenueAmount });

  // Credit royalty recipients
  for (const split of royaltyResult.splits) {
    // normalize recipient to accountId pattern: royalty:<recipientId>
    // If recipient is like "actor:alice", use "royalty:actor:alice" or allow custom mapping.
    const recipientAccount = `royalty:${split.recipient}`;
    lines.push({ accountId: recipientAccount, direction: 'credit', amount: split.amount });
  }

  // Basic balancing check — sum(debits) must equal sum(credits)
  const sumDebits = lines.filter((l) => l.direction === 'debit').reduce((s, l) => s + l.amount, 0);
  const sumCredits = lines.filter((l) => l.direction === 'credit').reduce((s, l) => s + l.amount, 0);

  // If imbalance due to rounding/bugs, add credit/debit to platform account to balance
  if (sumDebits !== sumCredits) {
    const diff = sumDebits - sumCredits;
    if (diff > 0) {
      // need extra credit
      lines.push({ accountId: 'platform:illuvrse', direction: 'credit', amount: diff });
    } else if (diff < 0) {
      // need extra debit
      lines.push({ accountId: 'platform:illuvrse', direction: 'debit', amount: -diff });
    }
  }

  // Build journal metadata
  const journalId = `journal-${shortDeterministicId(orderId)}`;
  const batchId = `batch-${shortDeterministicId(`${orderId}:batch`)}`;
  const timestamp = new Date().toISOString();

  const journal: JournalEntry = {
    journalId,
    batchId,
    timestamp,
    currency,
    lines,
    metadata: { source: 'marketplace', orderId, skuId },
  };

  return journal;
}

export default {
  computeRoyaltiesForSku,
  mapOrderToJournal,
};

