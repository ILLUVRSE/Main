import axios from 'axios';
import auditWriter from '../src/services/auditWriter';

describe('auditWriter.appendPolicyDecision', () => {
  test('resolves audit id when kernel returns id', async () => {
    process.env.KERNEL_AUDIT_URL = 'http://kernel-mock';
    const post = jest.fn().mockResolvedValue({ status: 202, data: { id: 'audit-42' } });
    const createSpy = jest.spyOn(axios, 'create').mockReturnValue({ post } as any);
    auditWriter.__resetHttpClientForTest();

    try {
      const result = await auditWriter.appendPolicyDecision(
        'policy-1',
        { action: 'kernel.agent.spawn', actor: { id: 'user-1' } },
        {
          decision: 'deny',
          allowed: false,
          policyId: 'policy-1',
          policyVersion: 1,
          rationale: 'unit-test',
          evidenceRefs: [],
          ts: new Date().toISOString(),
        },
      );

      expect(result).toBe('audit-42');
      expect(post).toHaveBeenCalledWith('/kernel/audit', expect.any(Object));
    } finally {
      delete process.env.KERNEL_AUDIT_URL;
      auditWriter.__resetHttpClientForTest();
      createSpy.mockRestore();
    }
  });
});
