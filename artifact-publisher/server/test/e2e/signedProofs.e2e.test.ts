import { createApplication } from '../../src/app.js';
import { startKernelMock } from '../helpers/kernel.js';

describe('Signed proof verification', () => {
  let kernel: Awaited<ReturnType<typeof startKernelMock>> | undefined;
  let services: ReturnType<typeof createApplication>['services'];

  beforeAll(async () => {
    kernel = await startKernelMock();
    ({ services } = createApplication({ kernel: { baseUrl: kernel.baseUrl, multisigThreshold: 2 } }));
  });

  afterAll(async () => {
    if (kernel) {
      await kernel.close();
    }
  });

  it('generates and verifies signed proofs with kernel audit chain', async () => {
    const payload = await services.checkoutService.processCheckout({
      customerId: 'cust-proof',
      email: 'audit@example.com',
      currency: 'usd',
      items: [{ sku: 'artifact-license', quantity: 1 }],
    });

    const proofVerification = services.proofService.verifyProof(payload.proof, {
      orderId: payload.orderId,
      paymentId: payload.payment.paymentId,
      financeEntry: payload.finance.entryId,
    });

    expect(proofVerification).toBe(true);

    const kernelAudit = await fetch(`${kernel.baseUrl}/audit/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ criteria: { orderId: payload.orderId } }),
    }).then((res) => res.json());

    expect(kernelAudit.results[0].event.orderId).toEqual(payload.orderId);
  });
});
