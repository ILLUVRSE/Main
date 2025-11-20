import crypto from 'crypto';
import { buildEncryptionBundle, DeliveryPreferences, DeliveryMode, resolveDeliveryMode } from './deliveryEncryption';

export type LedgerProof = {
  ledger_proof_id?: string;
  signer_kid?: string;
  signature?: string;
  payload?: any;
};

export type OrderLike = {
  order_id: string;
  sku_id: string;
  buyer_id: string;
  amount: number;
  currency: string;
  delivery_mode?: string;
  delivery_preferences?: DeliveryPreferences;
};

export type FulfillmentArtifacts = {
  license: any;
  delivery: any;
  proof: any;
  keyMetadata: Record<string, any>;
};

export async function buildFulfillmentArtifacts(
  order: OrderLike,
  ledgerProof: LedgerProof,
  prefs?: DeliveryPreferences,
  manifestSignatureId?: string
): Promise<FulfillmentArtifacts> {
  const preferenceSource: DeliveryPreferences =
    prefs || order.delivery_preferences || (order.delivery_mode ? { mode: order.delivery_mode as DeliveryMode } : {});

  const now = new Date();
  const licenseId = `lic-${now.getTime()}-${crypto.randomBytes(2).toString('hex')}`;
  const license = {
    license_id: licenseId,
    order_id: order.order_id,
    sku_id: order.sku_id,
    buyer_id: order.buyer_id,
    scope: { type: 'single-user', expires_at: new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString() },
    issued_at: now.toISOString(),
    signer_kid: process.env.MARKETPLACE_SIGNER_KID || 'marketplace-signer-v1',
    signature: Buffer.from(`license:${licenseId}`).toString('base64'),
  };

  const artifactSha256 = crypto.createHash('sha256').update(`${order.order_id}:${order.sku_id}`).digest('hex');
  const proofId = `proof-${now.getTime()}-${crypto.randomBytes(2).toString('hex')}`;

  const canonicalPayload = {
    proof_id: proofId,
    order_id: order.order_id,
    sku_id: order.sku_id,
    artifact_sha256: artifactSha256,
    ledger_proof_id: ledgerProof?.ledger_proof_id,
    delivery_mode: resolveDeliveryMode(preferenceSource),
  };

  const manifestSig = manifestSignatureId || (order as any).manifest_signature_id || `manifest-sig-${crypto.randomBytes(2).toString('hex')}`;

  const proof = {
    proof_id: proofId,
    order_id: order.order_id,
    artifact_sha256: artifactSha256,
    manifest_signature_id: manifestSig,
    ledger_proof_id: ledgerProof?.ledger_proof_id,
    signer_kid: process.env.ARTIFACT_PUBLISHER_SIGNER_KID || 'artifact-publisher-signer-v1',
    signature: Buffer.from(`proof:${proofId}`).toString('base64'),
    ts: now.toISOString(),
    canonical_payload: canonicalPayload,
  };

  const encryptionBundle = await buildEncryptionBundle(order, proof, ledgerProof, preferenceSource);

  const delivery = {
    delivery_id: `delivery-${now.getTime()}-${crypto.randomBytes(2).toString('hex')}`,
    status: 'ready',
    encrypted_delivery_url: `s3://encrypted/${proof.proof_id}`,
    proof_id: proof.proof_id,
    mode: encryptionBundle.mode,
    encryption: encryptionBundle.encryption,
    encrypted_payload: encryptionBundle.encryptedPayload,
    proof,
  };

  return {
    license: { ...license, manifest_signature_id: manifestSig },
    delivery,
    proof,
    keyMetadata: encryptionBundle.keyMetadata,
  };
}
