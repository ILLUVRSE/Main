import request from 'supertest';
import { createApplication } from '../../src/app.js';
import { startKernelMock } from '../helpers/kernel.js';
describe('Checkout flow E2E', () => {
    const kernel = startKernelMock();
    const app = createApplication({ kernel: { baseUrl: kernel.baseUrl, multisigThreshold: 2 } }).app;
    afterAll(async () => {
        await kernel.close();
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
        const response = await request(app).post('/api/checkout').send(cart).expect(201);
        const payload = response.body;
        expect(payload.orderId).toMatch(/^order_/);
        expect(payload.payment.paymentId).toMatch(/^pay_/);
        expect(payload.finance.entryId).toMatch(/^fin_/);
        expect(payload.proof.proofId).toMatch(/^proof_/);
        expect(payload.license.licenseId).toMatch(/^lic_/);
        expect(payload.delivery.deliveryId).toMatch(/^dlv_/);
        expect(payload.audit.auditId).toMatch(/^audit_/);
        const secondResponse = await request(app).post('/api/checkout').send(cart).expect(201);
        expect(secondResponse.body).toEqual(payload);
    });
});
