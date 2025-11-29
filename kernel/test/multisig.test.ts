
import request from 'supertest';
import { createApp } from '../src/server';
import { getClient } from '../src/db';
import { multisigService } from '../src/services/multisig';
import crypto from 'crypto';

describe('Multisig Upgrade Flow', () => {
  let app: any;
  let client: any;
  let signerIds: string[] = [];
  let privateKeys: Record<string, any> = {};

  beforeAll(async () => {
    app = await createApp();
    client = await getClient();

    // Generate 5 signer IDs and register them
    for (let i = 0; i < 5; i++) {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const signerId = `signer-${i}-${crypto.randomUUID()}`;
        signerIds.push(signerId);
        privateKeys[signerId] = privateKey;

        const pkPem = publicKey.export({ type: 'spki', format: 'pem' });
        await multisigService.registerSigner(signerId, pkPem as string, 'signer');
    }
  });

  afterAll(async () => {
    if (client) await client.release();
  });

  function sign(signerId: string, data: string): string {
      const sign = crypto.createSign('SHA256');
      sign.update(data);
      sign.end();
      return sign.sign(privateKeys[signerId], 'base64');
  }

  describe('Proposal Lifecycle', () => {
    it('should propose, approve, and apply a multisig proposal', async () => {
        const proposalId = `prop-${crypto.randomUUID()}`;
        const payload = { upgrade: 'v2' };
        const proposerId = signerIds[0];

        // 1. Propose
        const resPropose = await request(app)
            .post('/kernel/multisig/propose')
            .set('x-user-id', proposerId)
            .set('x-roles', 'operator')
            .send({
                proposal_id: proposalId,
                payload,
                signer_set: signerIds,
                required_threshold: 3
            })
            .expect(201);

        const dbId = resPropose.body.id; // UUID
        expect(resPropose.body.status).toBe('proposed');

        // 2. Approve with 2 signers (insufficient)
        const sig0 = sign(signerIds[0], proposalId);
        await request(app)
            .post(`/kernel/multisig/${dbId}/approve`)
            .set('x-user-id', signerIds[0])
            .set('x-roles', 'operator')
            .send({ signature: sig0 })
            .expect(200);

        const sig1 = sign(signerIds[1], proposalId);
        await request(app)
            .post(`/kernel/multisig/${dbId}/approve`)
            .set('x-user-id', signerIds[1])
            .set('x-roles', 'operator')
            .send({ signature: sig1 })
            .expect(200);

        // Try apply - should fail
        await request(app)
            .post(`/kernel/multisig/${dbId}/apply`)
            .set('x-user-id', proposerId)
            .set('x-roles', 'operator')
            .expect(500);

        // 3. Approve with 3rd signer
        const sig2 = sign(signerIds[2], proposalId);
        await request(app)
            .post(`/kernel/multisig/${dbId}/approve`)
            .set('x-user-id', signerIds[2])
            .set('x-roles', 'operator')
            .send({ signature: sig2 })
            .expect(200);

        // Check status
        const resGet = await request(app)
            .get(`/kernel/multisig/${dbId}`)
            .set('x-user-id', proposerId)
            .set('x-roles', 'operator')
            .expect(200);
        expect(resGet.body.status).toBe('approved');

        // 4. Apply
        await request(app)
            .post(`/kernel/multisig/${dbId}/apply`)
            .set('x-user-id', proposerId)
            .set('x-roles', 'operator')
            .expect(200);

        const resFinal = await request(app)
            .get(`/kernel/multisig/${dbId}`)
            .set('x-user-id', proposerId)
            .set('x-roles', 'operator')
            .expect(200);
        expect(resFinal.body.status).toBe('applied');
    });

    it('should support revocation', async () => {
        const proposalId = `prop-revoke-${crypto.randomUUID()}`;
        const proposerId = signerIds[0];
        const resPropose = await request(app)
            .post('/kernel/multisig/propose')
            .set('x-user-id', proposerId)
            .set('x-roles', 'operator')
            .send({
                proposal_id: proposalId,
                payload: {},
                signer_set: signerIds,
                required_threshold: 3
            })
            .expect(201);
        const dbId = resPropose.body.id;

        // Approve with 3
        for(let i=0; i<3; i++) {
            const sig = sign(signerIds[i], proposalId);
            await request(app)
                .post(`/kernel/multisig/${dbId}/approve`)
                .set('x-user-id', signerIds[i])
                .set('x-roles', 'operator')
                .send({ signature: sig })
                .expect(200);
        }

        let res = await request(app)
            .get(`/kernel/multisig/${dbId}`)
            .set('x-user-id', proposerId)
            .set('x-roles', 'operator')
            .expect(200);
        expect(res.body.status).toBe('approved');

        // Revoke 1
        await request(app)
            .post(`/kernel/multisig/${dbId}/revoke`)
            .set('x-user-id', signerIds[0])
            .set('x-roles', 'operator')
            .expect(200);

        // Check status reverted
        res = await request(app)
            .get(`/kernel/multisig/${dbId}`)
            .set('x-user-id', proposerId)
            .set('x-roles', 'operator')
            .expect(200);
        expect(res.body.status).toBe('proposed');

        // Try apply - fail
        await request(app)
            .post(`/kernel/multisig/${dbId}/apply`)
            .set('x-user-id', proposerId)
            .set('x-roles', 'operator')
            .expect(500);
    });

    it('should support emergency ratification', async () => {
        const proposalId = `prop-ratify-${crypto.randomUUID()}`;
        const proposerId = signerIds[0];
        const resPropose = await request(app)
            .post('/kernel/multisig/propose')
            .set('x-user-id', proposerId)
            .set('x-roles', 'operator')
            .send({
                proposal_id: proposalId,
                payload: {},
                signer_set: signerIds,
                required_threshold: 3
            })
            .expect(201);
        const dbId = resPropose.body.id;

        // Ratify immediately
        await request(app)
            .post(`/kernel/multisig/${dbId}/ratify`)
            .set('x-user-id', 'superadmin')
            .set('x-roles', 'superadmin')
            .send({ reason: 'Emergency fix' })
            .expect(200);

        const res = await request(app)
            .get(`/kernel/multisig/${dbId}`)
            .set('x-user-id', proposerId)
            .set('x-roles', 'operator')
            .expect(200);
        expect(res.body.status).toBe('ratified');
    });

    it('should reject tampered signature', async () => {
        const proposalId = `prop-tamper-${crypto.randomUUID()}`;
        const proposerId = signerIds[0];
        const resPropose = await request(app)
            .post('/kernel/multisig/propose')
            .set('x-user-id', proposerId)
            .set('x-roles', 'operator')
            .send({
                proposal_id: proposalId,
                payload: {},
                signer_set: signerIds,
                required_threshold: 3
            })
            .expect(201);
        const dbId = resPropose.body.id;

        // Try approve with WRONG signature
        const badSig = sign(signerIds[0], 'wrong-data');
        await request(app)
            .post(`/kernel/multisig/${dbId}/approve`)
            .set('x-user-id', signerIds[0])
            .set('x-roles', 'operator')
            .send({ signature: badSig })
            .expect(500); // Or 400 depending on error handling, service throws Error -> 500
    });
  });
});
