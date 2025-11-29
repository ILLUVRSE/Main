import request from 'supertest';
import { createApp } from '../src/server';
import { query, getClient } from '../src/db';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const isIntegration = process.env.POSTGRES_URL;

(isIntegration ? describe : describe.skip)('Multisig Integration', () => {
  let app: any;
  let signers: { id: string; privateKey: string; publicKey: string }[] = [];

  beforeAll(async () => {
    app = await createApp();
    // Create 5 signers
    for (let i = 0; i < 5; i++) {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
        });
        const publicKeyPem = publicKey.export({ type: 'pkcs1', format: 'pem' }) as string;
        const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
        const id = `signer-${i}`;
        signers.push({ id, privateKey: privateKeyPem, publicKey: publicKeyPem });

        // Register via DB directly or API? API requires superadmin.
        // Let's use DB to seed state if auth is annoying, but API is better.
        // We'll use DB query for setup to avoid auth overhead in this simple test.
        await query(
            `INSERT INTO multisig_signers (id, public_key, role, status) VALUES ($1, $2, 'signer', 'active') ON CONFLICT (id) DO NOTHING`,
            [id, publicKeyPem]
        );
    }
  });

  it('should create a proposal', async () => {
    const res = await request(app)
      .post('/multisig/proposals')
      .send({
        title: 'Upgrade Kernel',
        description: 'Update to v2',
        payload: { version: '2.0.0' }
      });

    // Auth might be required depending on env. In test env (non-prod), it might be relaxed or mocked.
    // kernel/src/routes/multisigRoutes.ts uses requireAuthInProduction().
    // If NODE_ENV != production, it should pass without auth or with simple auth.
    // However, rbac.ts behavior depends.
    // Let's see if we get 201.
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('pending');
  });

  it('should reach threshold and approve', async () => {
     // Create proposal
     const createRes = await request(app)
      .post('/multisig/proposals')
      .send({
        title: 'Another Upgrade',
        description: 'Update to v3',
        payload: { version: '3.0.0' }
      });
     const proposalId = createRes.body.id;

     // Sign with 3 signers
     for (let i = 0; i < 3; i++) {
         const signer = signers[i];
         const sign = crypto.createSign('SHA256');
         sign.update(proposalId);
         sign.end();
         const signature = sign.sign(signer.privateKey, 'base64');

         const approveRes = await request(app)
            .post(`/multisig/proposals/${proposalId}/approve`)
            .send({
                signerId: signer.id,
                signature
            });

         expect(approveRes.status).toBe(200);
         if (i < 2) {
             expect(approveRes.body.status).toBe('pending');
         } else {
             expect(approveRes.body.status).toBe('approved');
         }
     }
  });
});
