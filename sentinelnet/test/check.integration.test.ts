import policyStore from '../src/services/policyStore';
import auditWriter from '../src/services/auditWriter';
import { processCheckRequest } from '../src/routes/check';

jest.setTimeout(20000);

describe('POST /sentinelnet/check (integration)', () => {
  let listPoliciesSpy: jest.SpyInstance | undefined;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    if (listPoliciesSpy) listPoliciesSpy.mockRestore();
    listPoliciesSpy = undefined as any;
  });

  test('returns deny with policy metadata and emits audit event when policy matches', async () => {
    const policy = {
      id: 'policy-123',
      name: 'deny-critical-action',
      version: 2,
      severity: 'HIGH',
      rule: { '==': [{ var: 'action' }, 'kernel.agent.spawn'] },
      metadata: { effect: 'deny', ruleId: 'rule-1' },
      state: 'active',
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listPoliciesSpy = jest.spyOn(policyStore, 'listPolicies').mockResolvedValue([policy as any]);
    const auditSpy = jest.spyOn(auditWriter, 'appendPolicyDecision').mockResolvedValue('audit-1');

    const res = await processCheckRequest({
      action: 'kernel.agent.spawn',
      actor: { id: 'user-1' },
      requestId: 'req-123',
    });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('deny');
    expect(res.body.policyId).toBe('policy-123');
    expect(res.body.rationale).toContain('deny-critical-action');
    expect(res.body.evidence_refs[0]).toBe('audit:audit-1');
    expect(auditSpy).toHaveBeenCalled();

    auditSpy.mockRestore();
  });
});
