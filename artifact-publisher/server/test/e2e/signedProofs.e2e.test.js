import request from 'supertest';
import { createApplication } from '../../src/app.js';
import { startKernelMock } from '../helpers/kernel.js';
describe('Signed proof verification', () => {
    const kernel = startKernelMock();
    const app = createApplication({ kernel: { baseUrl: kernel.baseUrl, multisigThreshold: 2 } }).app;
    afterAll(async () => {
        await kernel.close();
    });
    it('generates and verifies signed proofs with kernel audit chain', async () => {
        const checkout = await request(app)
            .post('/api/checkout')
            .send({
            customerId: 'cust-proof',
            email: 'audit@example.com',
            currency: 'usd',
            items: [{ sku: 'artifact-license', quantity: 1 }],
        })
            .expect(201);
        const payload = checkout.body;
        const proofVerification = await request(app)
            .post('/api/proof/verify')
            .send({
            proof: payload.proof,
            payload: {
                orderId: payload.orderId,
                paymentId: payload.payment.paymentId,
                financeEntry: payload.finance.entryId,
            },
        })
            .expect(200);
        expect(proofVerification.body.valid).toBe(true);
        const kernelAudit = await fetch(`${kernel.baseUrl}/audit/search`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ criteria: { orderId: payload.orderId } }),
        }).then((res) => res.json());
        expect(kernelAudit.results[0].event.orderId).toEqual(payload.orderId);
    });
});
