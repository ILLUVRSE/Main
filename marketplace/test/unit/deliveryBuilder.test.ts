import { beforeAll, describe, expect, test } from 'vitest';
import crypto from 'crypto';

let buildFulfillmentArtifacts: typeof import('../../server/lib/fulfillment').buildFulfillmentArtifacts;

beforeAll(async () => {
  const moduleUrl = new URL('../../server/lib/fulfillment.ts', import.meta.url);
  ({ buildFulfillmentArtifacts } = await import(moduleUrl.href));
});

const baseOrder = {
  order_id: 'order-unit-123',
  sku_id: 'sku-unit-001',
  buyer_id: 'user:unit@example.com',
  amount: 1000,
  currency: 'USD',
  delivery_mode: 'marketplace-managed',
};

const ledgerProof = {
  ledger_proof_id: 'ledger-unit-1',
  signer_kid: 'finance-signer-v1',
  signature: 'base64sig',
};

describe('buildFulfillmentArtifacts', () => {
  test('produces buyer-managed bundles with encrypted key metadata', async () => {
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const artifacts = await buildFulfillmentArtifacts(
      {
        ...baseOrder,
        delivery_mode: 'buyer-managed',
        delivery_preferences: { mode: 'buyer-managed', buyer_public_key: publicKeyPem, key_identifier: 'test-buyer' },
      },
      ledgerProof
    );

    expect(artifacts.delivery.mode).toBe('buyer-managed');
    expect(artifacts.delivery.encryption.encrypted_key).toBeTruthy();
    expect(artifacts.keyMetadata.mode).toBe('buyer-managed');
    expect(artifacts.delivery.proof.canonical_payload).toBeTruthy();
  });

  test('falls back to marketplace-managed encryption with simulated kms proof when no key supplied', async () => {
    const artifacts = await buildFulfillmentArtifacts(baseOrder, ledgerProof);

    expect(artifacts.delivery.mode).toBe('marketplace-managed');
    expect(artifacts.delivery.encryption.kms).toBeDefined();
    expect(artifacts.keyMetadata.mode).toBe('marketplace-managed');
    expect(artifacts.delivery.proof.signature).toBeTruthy();
  });
});
