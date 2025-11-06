// kernel/test/sentinelClient.test.ts
import { setSentinelClient, resetSentinelClient, enforcePolicyOrThrow } from '../src/sentinel/sentinelClient';
import { appendAuditEvent } from '../src/auditStore';

jest.mock('../src/auditStore', () => ({
  appendAuditEvent: jest.fn().mockResolvedValue({ id: 'audit-1', hash: 'hash-1', ts: new Date().toISOString() }),
}));

describe('sentinelClient policy enforcement', () => {
  afterEach(() => {
    resetSentinelClient();
    (appendAuditEvent as jest.Mock).mockClear();
  });

  test('default client allows and records audit event', async () => {
    const decision = await enforcePolicyOrThrow('test.policy', { principal: { id: 'user-1', type: 'human', roles: ['Operator'] } });

    expect(decision.allowed).toBe(true);
    const auditCalls = (appendAuditEvent as jest.Mock).mock.calls;
    expect(auditCalls).toHaveLength(1);
    const [eventType, payload] = auditCalls[0];
    expect(eventType).toBe('policy.decision');
    expect(payload).toMatchObject({
      policy: 'test.policy',
      decision: { allowed: true },
      principal: { id: 'user-1', type: 'human', roles: ['Operator'] },
    });
  });

  test('custom sentinel denial throws and records audit event', async () => {
    const sentinel = {
      record: jest.fn(),
      enforcePolicy: jest.fn().mockResolvedValue({
        allowed: false,
        decisionId: 'deny-1',
        ruleId: 'rule-42',
        rationale: 'nope',
        reason: 'nope',
      }),
    };

    setSentinelClient(sentinel);

    await expect(() => enforcePolicyOrThrow('test.policy', { principal: { id: 'user-2' } })).rejects.toThrow('policy.denied');

    const auditCalls = (appendAuditEvent as jest.Mock).mock.calls;
    expect(auditCalls).toHaveLength(1);
    const [eventType, payload] = auditCalls[0];
    expect(eventType).toBe('policy.decision');
    expect(payload.decision).toMatchObject({
      id: 'deny-1',
      ruleId: 'rule-42',
      rationale: 'nope',
      allowed: false,
    });
  });

  test('invalid sentinel response falls back to allow and records audit', async () => {
    const sentinel = {
      record: jest.fn(),
      enforcePolicy: jest.fn().mockResolvedValue({ any: 'thing' }),
    };
    setSentinelClient(sentinel);

    const decision = await enforcePolicyOrThrow('test.policy', {});
    expect(decision.allowed).toBe(true);

    const auditCalls = (appendAuditEvent as jest.Mock).mock.calls;
    expect(auditCalls).toHaveLength(1);
    const [, payload] = auditCalls[0];
    expect(payload.decision.allowed).toBe(true);
    expect(payload.decision.ruleId).toBe('invalid-decision');
  });
});
