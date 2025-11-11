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
    // reset metrics
    auditMetrics.audit_write_success_total = 0;
    auditMetrics.audit_write_failure_total = 0;

    // create a fresh MockDb and stub getClient
    db = new MockDb();
    jest.spyOn(dbModule, 'getClient').mockImplementation(async () => db.createClient());

    // signing proxy returns deterministic signature
    signDataMock.mockResolvedValue({ signature: 'sig-base64', signerId: 'test-signer' });

    // audit policy: always keep, no special retention
    evalPolicyMock.mockReturnValue({ keep: true, retentionExpiresAt: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    signDataMock.mockReset();
    evalPolicyMock.mockReset();
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

    // Second append with identical payload should return same id/hash (idempotent)
    const result2 = await appendAuditEvent('test.event', payload);
    expect(result2).toEqual(result1);

    // Signing should have been called only once
    expect(signDataMock).toHaveBeenCalledTimes(1);

    // Audit success metric should not count the idempotent repeat as a second write.
    expect(auditMetrics.audit_write_success_total).toBe(successAfterFirst);

    // Verify the row exists in the mock DB (if MockDb exposes state)
    const state = db.getState ? db.getState() : null;
    if (state && state.audit_events) {
      // Must have exactly one audit event
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

