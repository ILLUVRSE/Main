import request from 'supertest';
import { createApplication } from '../../src/app.js';
import { startKernelMock } from '../helpers/kernel.js';
describe('Multisig upgrade', () => {
    const kernel = startKernelMock();
    const app = createApplication({ kernel: { baseUrl: kernel.baseUrl, multisigThreshold: 2 } }).app;
    afterAll(async () => {
        await kernel.close();
    });
    it('runs deterministic upgrade approvals', async () => {
        const response = await request(app)
            .post('/api/multisig/upgrade')
            .send({
            version: '2.0.0',
            binaryHash: 'deadbeef',
            approvers: ['finance', 'security'],
        })
            .expect(200);
        expect(response.body.upgradeId).toMatch(/^upg_/);
        expect(response.body.approvals).toHaveLength(2);
        expect(response.body.appliedAt).toBeTruthy();
    });
});
