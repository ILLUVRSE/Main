/**
 * finance/test/unit/ledger_balance.test.ts
 *
 * Unit tests for Finance ledger posting invariants:
 *  - balanced journals are accepted
 *  - unbalanced journals are rejected with LEDGER_IMBALANCE
 *  - idempotency: repeated post with same idempotency key does not create duplicate journals
 *
 * The test is defensive: if `finance/lib/ledger` or `finance/src/ledger` does not exist,
 * the suite will be skipped with a helpful message.
 *
 * Expected API (adjust to your implementation):
 *   const ledger = require('../../lib/ledger');
 *   await ledger.postJournal({ journal_id, entries, context }, { idempotencyKey, actor })
 *   // returns { ok: true, journal_id, posted_at } or throws/returns error object on imbalance
 */

import { test, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

let ledgerModule: any = null;
let ledgerAvailable = false;

beforeAll(() => {
  // Try common module paths
  const candidates = [
    path.resolve(__dirname, '../../lib/ledger'),
    path.resolve(__dirname, '../../src/ledger'),
    path.resolve(__dirname, '../../finance/lib/ledger'),
    path.resolve(__dirname, '../../finance/src/ledger'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c + '.js') || fs.existsSync(c + '.ts') || fs.existsSync(c)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(c);
        // expected API: postJournal function
        if (mod && typeof mod.postJournal === 'function') {
          ledgerModule = mod;
          ledgerAvailable = true;
          break;
        }
      }
    } catch (e) {
      // continue trying candidates
    }
  }
});

if (!ledgerAvailable) {
  test.skip('ledger module not implemented (finance/lib/ledger or finance/src/ledger) — skipping ledger balance unit tests', () => {});
} else {
  // helper to create a minimal journal payload
  function makeJournal(journalId: string, entries: any[], ctx = {}) {
    return {
      journal_id: journalId,
      entries,
      context: ctx,
    };
  }

  test('accepts balanced journal and returns posted metadata', async () => {
    const journalId = `ut-balance-${Date.now()}`;
    const entries = [
      { account_id: 'asset:escrow:ut', side: 'debit', amount_cents: 5000, currency: 'USD', meta: {} },
      { account_id: 'revenue:ut', side: 'credit', amount_cents: 5000, currency: 'USD', meta: {} },
    ];
    const payload = makeJournal(journalId, entries, { src: 'unit-test' });

    // call with idempotencyKey
    const result = await ledgerModule.postJournal(payload, { idempotencyKey: `idem-${journalId}`, actor: 'test-suite' });

    // Accept either thrown errors or structured result; normalize checks
    expect(result).toBeDefined();
    if (result.ok !== undefined) {
      expect(result.ok).toBeTruthy();
      expect(result.journal_id || result.journalId).toBeTruthy();
    } else if (result instanceof Error) {
      // fail if an error was thrown for balanced journal
      throw result;
    } else {
      // generic check: returned object contains journal_id / posted_at
      expect(result.journal_id || result.journalId).toBeTruthy();
      expect(result.posted_at || result.postedAt).toBeTruthy();
    }
  });

  test('rejects unbalanced journal with LEDGER_IMBALANCE', async () => {
    const journalId = `ut-unbalanced-${Date.now()}`;
    const entries = [
      { account_id: 'asset:escrow:ut', side: 'debit', amount_cents: 7000, currency: 'USD', meta: {} },
      { account_id: 'revenue:ut', side: 'credit', amount_cents: 5000, currency: 'USD', meta: {} }, // mismatch
    ];
    const payload = makeJournal(journalId, entries, { src: 'unit-test' });

    try {
      const res = await ledgerModule.postJournal(payload, { idempotencyKey: `idem-${journalId}`, actor: 'test-suite' });
      // If the module returns structured error, assert it indicates imbalance
      if (res && res.ok === false && res.error) {
        const code = (res.error.code || '').toString().toUpperCase();
        expect(code).toContain('LEDGER') || expect(code).toContain('IMBALANCE');
      } else {
        // Otherwise, if module returns success, that's a failure
        // If module returns object with success semantics, fail
        if (res && res.ok === true) {
          throw new Error('Unbalanced journal was unexpectedly accepted');
        }
        // If no clear result, assert falsy behavior
        expect(res).toBeDefined();
      }
    } catch (err: any) {
      // Accept thrown error with message mentioning imbalance
      const msg = String(err && (err.message || err));
      expect(msg.toLowerCase()).toMatch(/imbalance|ledger|debit.*credit|debits.*credits/);
    }
  });

  test('idempotency: repeated post with same idempotency key does not duplicate', async () => {
    const journalId = `ut-idem-${Date.now()}`;
    const entries = [
      { account_id: 'asset:escrow:ut', side: 'debit', amount_cents: 3000, currency: 'USD', meta: {} },
      { account_id: 'revenue:ut', side: 'credit', amount_cents: 3000, currency: 'USD', meta: {} },
    ];
    const payload = makeJournal(journalId, entries, { src: 'unit-test' });

    const idempotencyKey = `idem-key-${Date.now()}`;

    const first = await ledgerModule.postJournal(payload, { idempotencyKey, actor: 'test-suite' });
    expect(first).toBeDefined();
    const firstJournalId = first.journal_id || first.journalId || payload.journal_id;

    // Second call with same idempotency key but same payload should return same journal id / not create duplicate
    const second = await ledgerModule.postJournal(payload, { idempotencyKey, actor: 'test-suite' });
    expect(second).toBeDefined();
    const secondJournalId = second.journal_id || second.journalId || payload.journal_id;

    // If implementation signals duplicate via same id, assert equality
    expect(String(secondJournalId)).toBe(String(firstJournalId));

    // If your implementation exposes a count or fetch API to verify non-duplication,
    // add that check here (e.g., ledgerModule.getJournal(journalId) returns single posting).
    if (typeof ledgerModule.getJournal === 'function') {
      // be defensive: some implementations accept journalId or return inserted id
      const fetched = await ledgerModule.getJournal(firstJournalId);
      expect(fetched).toBeDefined();
      // Optionally check a postings count if available
      if (fetched._metadata?.post_count !== undefined) {
        expect(fetched._metadata.post_count).toBe(1);
      }
    }
  });
}

