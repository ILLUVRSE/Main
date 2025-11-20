import crypto, { constants } from 'crypto';
import { KmsClient } from './kmsClient';

export type DeliveryMode = 'buyer-managed' | 'marketplace-managed';

export type DeliveryPreferences = {
  mode?: DeliveryMode;
  encryption?: string;
  buyer_public_key?: string;
  key_identifier?: string;
  kms_key_id?: string;
  kms_alias?: string;
};

export type EncryptionBundle = {
  mode: DeliveryMode;
  encryption: {
    algorithm: string;
    iv: string;
    auth_tag: string;
    encrypted_key: string;
    key_fingerprint?: string;
    key_hint?: string;
    kms?: {
      signer_kid?: string;
      signature?: string;
      ts?: string;
      key_id?: string;
      simulated?: boolean;
    };
  };
  encryptedPayload: string;
  keyMetadata: Record<string, any>;
};

const kmsClient = new KmsClient();
const DEV_SIGNING_SECRET = process.env.MARKETPLACE_DEV_SIGNING_SECRET || 'marketplace-dev-key';

function normalizePublicKey(pem: string): string {
  const trimmed = pem.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed;
  return `-----BEGIN PUBLIC KEY-----\n${trimmed}\n-----END PUBLIC KEY-----`;
}

function fingerprintKey(pem: string): string {
  return crypto.createHash('sha256').update(pem.trim()).digest('hex');
}

function encryptPayload(key: Buffer, payload: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

async function buildBuyerManagedBundle(order: any, prefs: DeliveryPreferences, payload: Buffer): Promise<EncryptionBundle> {
  if (!prefs.buyer_public_key) {
    throw new Error('buyer_public_key is required for buyer-managed deliveries');
  }

  const key = crypto.randomBytes(32);
  const encryptedKey = crypto.publicEncrypt(
    {
      key: normalizePublicKey(prefs.buyer_public_key),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    key
  );

  const enc = encryptPayload(key, payload);
  const fingerprint = fingerprintKey(prefs.buyer_public_key);

  return {
    mode: 'buyer-managed',
    encryption: {
      algorithm: 'aes-256-gcm',
      iv: enc.iv,
      auth_tag: enc.authTag,
      encrypted_key: encryptedKey.toString('base64'),
      key_fingerprint: fingerprint,
      key_hint: prefs.key_identifier || 'buyer-public-key',
    },
    encryptedPayload: enc.ciphertext,
    keyMetadata: {
      mode: 'buyer-managed',
      buyer_public_key_fingerprint: fingerprint,
      key_identifier: prefs.key_identifier || null,
      algorithm: 'RSA-OAEP-256',
      created_at: new Date().toISOString(),
    },
  };
}

async function signWithKms(data: Buffer, keyId?: string) {
  try {
    if (kmsClient.isConfigured()) {
      return await kmsClient.sign(data, { keyId });
    }
  } catch (err) {
    console.debug('kmsClient.sign failed, falling back to dev signature:', (err as Error).message);
  }

  const signature = crypto.createHmac('sha256', DEV_SIGNING_SECRET).update(data).digest('base64');
  return {
    signature,
    signer_kid: 'dev-marketplace-kms',
    ts: new Date().toISOString(),
    simulated: true,
  };
}

async function buildMarketplaceManagedBundle(order: any, prefs: DeliveryPreferences, payload: Buffer): Promise<EncryptionBundle> {
  const key = crypto.randomBytes(32);
  const enc = encryptPayload(key, payload);
  const encryptedKey = crypto
    .createCipheriv('aes-256-ctr', key, Buffer.alloc(16, 0))
    .update(key)
    .toString('base64');

  const kmsKeyId = prefs.kms_key_id || process.env.MARKETPLACE_KMS_KEY_ID || process.env.AWS_KMS_KEY_ID;
  const kmsProof = await signWithKms(key, kmsKeyId);

  return {
    mode: 'marketplace-managed',
    encryption: {
      algorithm: 'aes-256-gcm',
      iv: enc.iv,
      auth_tag: enc.authTag,
      encrypted_key: encryptedKey,
      kms: {
        signer_kid: kmsProof?.signer_kid,
        signature: kmsProof?.signature,
        ts: kmsProof?.ts,
        key_id: kmsKeyId,
        simulated: kmsProof && 'simulated' in kmsProof ? kmsProof.simulated : !kmsClient.isConfigured(),
      },
    },
    encryptedPayload: enc.ciphertext,
    keyMetadata: {
      mode: 'marketplace-managed',
      kms_key_id: kmsKeyId,
      signer_kid: kmsProof?.signer_kid,
      signature: kmsProof?.signature,
      created_at: new Date().toISOString(),
      simulated: kmsProof && 'simulated' in kmsProof ? kmsProof.simulated : !kmsClient.isConfigured(),
    },
  };
}

export function resolveDeliveryMode(prefs?: DeliveryPreferences): DeliveryMode {
  const prefMode = prefs?.mode?.toLowerCase();
  if (prefMode === 'buyer-managed') return 'buyer-managed';
  if (prefs?.encryption && String(prefs.encryption).toLowerCase().includes('buyer')) return 'buyer-managed';
  return 'marketplace-managed';
}

export async function buildEncryptionBundle(
  order: any,
  proof: any,
  ledgerProof: any,
  prefs?: DeliveryPreferences
): Promise<EncryptionBundle> {
  const mode = resolveDeliveryMode(prefs);
  const payload = Buffer.from(
    JSON.stringify({
      order_id: order.order_id,
      sku_id: order.sku_id,
      proof_id: proof?.proof_id,
      ledger_proof_id: ledgerProof?.ledger_proof_id || ledgerProof?.ledgerProofId,
      mode,
    }),
    'utf8'
  );

  if (mode === 'buyer-managed') {
    return buildBuyerManagedBundle(order, { ...prefs, mode }, payload);
  }
  return buildMarketplaceManagedBundle(order, { ...prefs, mode }, payload);
}
