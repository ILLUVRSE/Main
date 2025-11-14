import { createApplication } from '../../src/app.js';
import { startKernelMock } from '../helpers/kernel.js';

describe('Checkout flow E2E', () => {
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

  const cart = {
    customerId: 'cust-123',
    email: 'dev@example.com',
    currency: 'usd',
    items: [
      { sku: 'creator-basic', quantity: 1 },
      { sku: 'artifact-license', quantity: 2 },
    ],
  };

  it('processes checkout with payment -> finance -> proof -> license -> delivery', async () => {
    const payload = await services.checkoutService.processCheckout(cart);

    expect(payload.orderId).toMatch(/^order_/);
    expect(payload.payment.paymentId).toMatch(/^pay_/);
    expect(payload.finance.entryId).toMatch(/^fin_/);
    expect(payload.proof.proofId).toMatch(/^proof_/);
    expect(payload.license.licenseId).toMatch(/^lic_/);
    expect(payload.delivery.deliveryId).toMatch(/^dlv_/);
    expect(payload.audit.auditId).toMatch(/^audit_/);

    const secondResponse = await services.checkoutService.processCheckout(cart);
    expect(secondResponse).toEqual(payload);
  });
});
