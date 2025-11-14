import axios from 'axios';
import multisigGating from '../src/services/multisigGating';

describe('multisigGating', () => {
  test('creates, approves, and applies a policy activation upgrade via mocked kernel client', async () => {
    process.env.KERNEL_URL = 'http://kernel';
    const post = jest.fn((url: string) => {
      if (url === '/kernel/upgrade') {
        return Promise.resolve({ status: 201, data: { upgrade: { upgradeId: 'upgrade-1', status: 'pending' } } });
      }
      if (url.includes('/approve')) {
        return Promise.resolve({ status: 201, data: { approval: { approverId: 'approver-1' } } });
      }
      if (url.includes('/apply')) {
        return Promise.resolve({ status: 200, data: { upgrade: { status: 'applied' } } });
      }
      return Promise.reject(new Error('unexpected url'));
    });
    const get = jest.fn().mockResolvedValue({ status: 200, data: { upgrade: { status: 'applied' } } });
    const createSpy = jest.spyOn(axios, 'create').mockReturnValue({ post, get } as any);
    multisigGating.__resetHttpClientForTest();

    try {
      const manifest = {
        target: { policyId: 'policy-critical', version: 3 },
        rationale: 'block suspicious orchestrations',
        impact: { blastRadius: 'all clusters' },
        preconditions: { simulation: 'complete' },
      };
      const created = await multisigGating.createPolicyActivationUpgrade(manifest, 'tester');
      expect(created.upgrade).toBeDefined();
      const upgradeId = created.upgrade.upgradeId;

      const approval = await multisigGating.submitUpgradeApproval(upgradeId, 'approver-1', 'sig-1', 'LGTM');
      expect(approval).toBeDefined();

      const applied = await multisigGating.applyUpgrade(upgradeId, 'deployer-1');
      expect(applied.upgrade.status).toBe('applied');
    } finally {
      delete process.env.KERNEL_URL;
      multisigGating.__resetHttpClientForTest();
      createSpy.mockRestore();
    }
  });
});
