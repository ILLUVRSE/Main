import { KernelClient } from '../../src/services/kernel/kernelClient.js';
import { createApplication } from '../../src/app.js';
import { startKernelMock } from '../helpers/kernel.js';

describe('Multisig upgrade', () => {
  let kernel: Awaited<ReturnType<typeof startKernelMock>> | undefined;
  let client: KernelClient;

  beforeAll(async () => {
    kernel = await startKernelMock();
    createApplication({ kernel: { baseUrl: kernel.baseUrl, multisigThreshold: 2 } });
    client = new KernelClient(kernel.baseUrl);
  });

  afterAll(async () => {
    if (kernel) {
      await kernel.close();
    }
  });

  it('runs deterministic upgrade approvals', async () => {
    const response = await client.runMultisigUpgrade({
      version: '2.0.0',
      binaryHash: 'deadbeef',
      approvers: ['finance', 'security'],
    });

    expect(response.upgradeId).toMatch(/^upg_/);
    expect(response.approvals).toHaveLength(2);
    expect(response.appliedAt).toBeTruthy();
  });
});
