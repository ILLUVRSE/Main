import auditHandler from '../src/event/handler';
import policyStore from '../src/services/policyStore';
import auditWriter from '../src/services/auditWriter';

describe('event handler', () => {
  test('evaluates audit event and emits policy decision via audit writer', async () => {
    const policy = {
      id: 'policy-async',
      name: 'async-deny',
      version: 1,
      severity: 'HIGH',
      rule: { '==': [{ var: 'action' }, 'kernel.async.event'] },
      metadata: { effect: 'deny' },
      state: 'active',
      createdBy: 'tester',
      createdAt: new Date().toISOString(),
    };
    const listSpy = jest.spyOn(policyStore, 'listPolicies').mockResolvedValue([policy as any]);
    const auditSpy = jest.spyOn(auditWriter, 'appendPolicyDecision').mockResolvedValue('audit-1');

    try {
      await auditHandler.handleAuditEvent({
        id: 'audit-evt',
        eventType: 'kernel.audit',
        payload: {
          action: 'kernel.async.event',
          principal: { id: 'actor-1' },
        },
        ts: new Date().toISOString(),
      });

      expect(auditSpy).toHaveBeenCalledWith(
        'policy-async',
        expect.any(Object),
        expect.objectContaining({ decision: 'deny' }),
      );
    } finally {
      listSpy.mockRestore();
      auditSpy.mockRestore();
    }
  });
});
