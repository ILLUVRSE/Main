/**
 * kernel/test/unit/auditStore.test.ts
 *
 * Unit tests for appendAuditEvent idempotency and retry semantics (basic).
 *
 * - Uses the repo MockDb helper to simulate Postgres.
 * - Mocks signingProxy.signData to return a deterministic signature.
 * - Mocks auditPolicy to always keep events.
 */

import { appendAuditEvent, auditMetrics, getAuditEventById } from '../../src/auditStore';
import * as dbModule from '../../src/db';
import signingProxy from '../../src/signingProxy';
import { MockDb } from '../utils/mockDb';
import { evaluateAuditPolicy } from '../../src/audit/auditPolicy';

jest.mock('../../src/signingProxy', () => ({
  __esModule: true,
  default: {
    signData: jest.fn(),
    signManifest: jest.fn(),
    _internal: {},
  },
}));

jest.mock('../../src/audit/auditPolicy', () => ({
  evaluateAuditPolicy: jest.fn(),
}));

describe('appendAuditEvent (unit)', () => {
  let db: MockDb;
  const signDataMock = (signingProxy as any).signData as jest.Mock;
  const evalPolicyMock = (evaluateAuditPolicy as any) as jest.Mock;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    // reset metrics
    auditMetrics.audit_write_success_total = 0;
    auditMetrics.audit_write_failure_total = 0;

    // create a fresh MockDb and stub getClient
    db = new MockDb();
    jest.spyOn(dbModule, 'getClient').mockImplementation(async () => {
      const base = db.createClient();
      return {
        query: async (text: string, params?: any[]) => {
          const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
          if (
            normalized.startsWith('select hash from audit_events') &&
            normalized.includes('order by') &&
            normalized.includes('limit 1')
          ) {
            return { rows: [], rowCount: 0, fields: [], command: '', oid: 0 };
          }
          return (base as any).query(text, params);
        },
        release: () => (base as any).release(),
      } as any;
    });

    // signing proxy returns deterministic signature
    signDataMock.mockResolvedValue({ signature: 'sig-base64', signerId: 'test-signer' });

    // audit policy: always keep, no special retention
    evalPolicyMock.mockReturnValue({ keep: true, retentionExpiresAt: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    signDataMock.mockReset();
    evalPolicyMock.mockReset();
    jest.useRealTimers();
  });

  test('appendAuditEvent inserts and is idempotent for identical payloads', async () => {
    const payload = { thing: 'value', n: 1 };

    // First append
    const result1 = await appendAuditEvent('test.event', payload);
    expect(result1).toHaveProperty('id');
    expect(result1).toHaveProperty('hash');
    expect(typeof result1.hash).toBe('string');
    expect(auditMetrics.audit_write_success_total).toBeGreaterThanOrEqual(1);

    // Record current metrics and DB state
    const successAfterFirst = auditMetrics.audit_write_success_total;

    // Second append with identical payload should behave idempotently (no re-sign / no new row)
    const result2 = await appendAuditEvent('test.event', payload);
    expect(result2).toHaveProperty('id');
    expect(typeof result2.id).toBe('string');
    expect(result2).toHaveProperty('hash');
    expect(typeof result2.hash).toBe('string');

    // Signing should have been called only once
    expect(signDataMock).toHaveBeenCalledTimes(1);

    // Audit success metric should not count the idempotent repeat as a second write.
    expect(auditMetrics.audit_write_success_total).toBe(successAfterFirst);

    // Verify the row exists in the mock DB (if MockDb exposes state)
    const state = db.getState ? db.getState() : null;
    if (state && state.audit_events) {
      expect(state.audit_events.size).toBe(1);
    }
  });

  test('appendAuditEvent returns sampled for policy.keep == false', async () => {
    evalPolicyMock.mockReturnValueOnce({ keep: false });

    const res = await appendAuditEvent('test.sampled', { a: 1 });
    expect(res.id).toBe('sampled');
    // No writes, so success metric unchanged
    expect(auditMetrics.audit_write_success_total).toBe(0);
  });
});
