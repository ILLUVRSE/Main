/**
 * kernel/test/unit/auditStore_extra.test.ts
 *
 * Extra unit tests for appendAuditEvent and auditStore behaviors:
 * - idempotent path with frozen time
 * - sampled policy path
 * - getAuditEventById
 * - transient DB error -> retry succeeds
 * - non-transient DB error -> bubbles
 *
 * Relies on test/utils/mockDb.ts MockDb helper.
 */

import { randomUUID } from 'crypto';
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

describe('appendAuditEvent (extra unit tests)', () => {
  let db: MockDb;
  const signDataMock = (signingProxy as any).signData as jest.Mock;
  const evalPolicyMock = (evaluateAuditPolicy as any) as jest.Mock;

  beforeEach(() => {
    // reset metrics
    auditMetrics.audit_write_success_total = 0;
    auditMetrics.audit_write_failure_total = 0;

    // create a fresh MockDb and stub getClient to return a mock client by default
    db = new MockDb();
    jest.spyOn(dbModule, 'getClient').mockImplementation(async () => db.createClient());
    jest.spyOn(dbModule, 'query').mockImplementation((text: string, params?: any[]) => db.handleQuery(text, params ?? []));

    // signing proxy returns deterministic signature
    signDataMock.mockResolvedValue({ signature: 'sig-base64', signerId: 'test-signer' });

    // audit policy: default keep true
    evalPolicyMock.mockReturnValue({ keep: true, retentionExpiresAt: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    signDataMock.mockReset();
    evalPolicyMock.mockReset();
    // ensure timers restored if any test used fake timers
    try {
      if ((jest as any).isMockFunction && (global as any).setImmediate) {
        // nothing
      }
    } finally {
      if ((jest as any).useRealTimers) {
        jest.useRealTimers();
      }
    }
  });

  test('appendAuditEvent idempotent when time and chain head are stable', async () => {
    // Freeze time so hash computation is stable between calls
    const now = new Date('2025-11-13T22:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    // Ensure the "last hash" query returns null/empty so prevHash is stable (MockDb does this by default)
    const payload = { thing: 'value', n: 1 };

    // First append
    const r1 = await appendAuditEvent('test.event', payload);
    expect(r1).toHaveProperty('id');
    expect(r1).toHaveProperty('hash');

    const successAfterFirst = auditMetrics.audit_write_success_total;

    // Force the "latest head" query to return empty result so prevHash remains stable.
    const originalHandleQuery = db.handleQuery.bind(db);
    const emptyResult = { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };
    const handleSpy = jest.spyOn(db, 'handleQuery').mockImplementation(async (text: string, params: any[] = []) => {
      const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.startsWith('select hash from audit_events') && normalized.includes('order by ts desc') && normalized.includes('limit 1')) {
        return emptyResult;
      }
      return originalHandleQuery(text, params);
    });

    // Second append with identical payload should be treated idempotently.
    // Because we've frozen time, computed hash should match and the function may take the idempotent fast-path.
    const r2 = await appendAuditEvent('test.event', payload);

    handleSpy.mockRestore();

    // r2 must contain id/hash, and metric should not increment for duplicate
    expect(r2).toHaveProperty('id');
    expect(r2).toHaveProperty('hash');
    expect(r2.id).toBe(r1.id);
    expect(r2.hash).toBe(r1.hash);
    expect(auditMetrics.audit_write_success_total).toBe(successAfterFirst);

    // Underlying MockDb should have exactly one audit_events row
    const state = db.getState ? db.getState() : null;
    if (state && state.audit_events) {
      expect(state.audit_events.size).toBe(1);
    }

    jest.useRealTimers();
  });

  test('appendAuditEvent returns sampled when policy.keep == false', async () => {
    evalPolicyMock.mockReturnValueOnce({ keep: false });
    const res = await appendAuditEvent('test.sampled', { a: 1 });

    expect(res.id).toBe('sampled');
    // No DB writes -> write-success metric unchanged
    expect(auditMetrics.audit_write_success_total).toBe(0);
  });

  test('getAuditEventById returns the stored row', async () => {
    const payload = { foo: 'bar' };
    const appended = await appendAuditEvent('test.get', payload);
    expect(appended).toHaveProperty('id');

    const fetched = await getAuditEventById(appended.id);
    expect(fetched).toBeTruthy();
    if (!fetched) {
      throw new Error('expected audit event to be fetched');
    }
    // fetched should contain id and hash and payload shape (payload might be redacted/JSON-ified)
    expect(fetched.id).toBe(appended.id);
    expect(fetched.hash).toBe(appended.hash);
  });

  test('appendAuditEvent retries on transient DB error then succeeds', async () => {
    // We'll create a wrapper client that delegates to MockDb but throws a transient error
    // on the first "insert into audit_events" call, then delegates to real client.
    const realClient = await db.createClient() as any;
    let injectedClientCreated = false;
    let thrownOnce = false;

    const wrapper = {
      query: async (text: string, params?: any[]) => {
        const lower = String(text || '').toLowerCase();
        if (!thrownOnce && lower.includes('insert into audit_events')) {
          thrownOnce = true;
          const e: any = new Error('simulated transient timeout');
          // Use a pg error code commonly treated as transient (e.g., 40001 serialization_failure) or a generic marker
          e.code = '40001';
          throw e;
        }
        // otherwise delegate to the real mock client
        return realClient.query(text, params ?? []);
      },
      release: () => {
        if (realClient && typeof realClient.release === 'function') {
          realClient.release();
        }
      },
    };

    // Spy getClient to return wrapper
    jest.spyOn(dbModule, 'getClient').mockImplementation(async () => wrapper as any);

    // Now call appendAuditEvent - it should survive the transient error and eventually succeed
    const payload = { t: 'retry' };
    const res = await appendAuditEvent('test.transient', payload);

    expect(res).toBeDefined();
    expect(res).toHaveProperty('id');
    expect(res).toHaveProperty('hash');
    // Ensure we recorded a success in metrics
    expect(auditMetrics.audit_write_success_total).toBeGreaterThanOrEqual(1);
  });

  test('appendAuditEvent bubbles non-transient DB errors', async () => {
    // Wrapper that throws a non-transient error on insert
    const realClient = await db.createClient() as any;
    const wrapper = {
      query: async (text: string, params?: any[]) => {
        const lower = String(text || '').toLowerCase();
        if (lower.includes('insert into audit_events')) {
          const e: any = new Error('simulated non-transient error');
          // Use a non-transient error code (e.g., unique violation)
          e.code = '23505';
          throw e;
        }
        return realClient.query(text, params ?? []);
      },
      release: () => {
        if (realClient && typeof realClient.release === 'function') {
          realClient.release();
        }
      },
    };

    jest.spyOn(dbModule, 'getClient').mockImplementation(async () => wrapper as any);

    const payload = { t: 'fail' };

    await expect(appendAuditEvent('test.nontransient', payload)).rejects.toThrow(/simulated non-transient error/);
    // no success metric increase
    expect(auditMetrics.audit_write_success_total).toBe(0);
    // failure metric incremented (code may increment it before rethrow)
    expect(auditMetrics.audit_write_failure_total).toBeGreaterThanOrEqual(1);
  });
});
