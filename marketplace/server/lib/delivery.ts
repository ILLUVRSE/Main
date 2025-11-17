/**
 * marketplace/server/lib/delivery.ts
 *
 * Helpers for encrypted delivery:
 *  - encryptBufferWithBuyerKey(plain, buyerPublicKeyPem)
 *  - encryptBufferWithKms(plain, kmsKeyId)  // uses GenerateDataKey, returns ciphertext + encryptedDataKey (base64)
 *  - uploadBufferToS3(buffer, bucket, key)  // uploads to S3 (MinIO-compatible)
 *  - createEncryptedDelivery({ artifactBuffer, skuId, orderId, buyerPublicKeyPem?, kmsKeyId?, s3Bucket, s3KeyPrefix })
 *
 * Returns:
 *  {
 *    s3Uri: 's3://bucket/key',
 *    delivery: {
 *      delivery_id,
 *      encrypted_delivery_url: s3Uri,
 *      key_provenance: { method: 'buyer-key'|'kms', encrypted_key_b64, key_id, signer_kid? },
 *      artifact_sha256,
 *    }
 *  }
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { KMSClient, GenerateDataKeyCommand } from '@aws-sdk/client-kms';

type KeyProvenance =
  | {
      method: 'buyer-key';
      encrypted_key_b64: string; // AES key encrypted with buyer public key (base64)
      algorithm: 'RSA-OAEP+AES-256-GCM';
      buyer_key_fingerprint?: string;
    }
  | {
      method: 'kms';
      encrypted_data_key_b64: string; // KMS encrypted data key (base64)
      kms_key_id: string;
      algorithm: 'KMS:GenerateDataKey:AES-256-GCM';
    };

function readPemMaybe(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    if (fs.existsSync(value)) {
      return fs.readFileSync(value, 'utf8');
    }
  } catch {
    // ignore
  }
  return value;
}

/**
 * Encrypt buffer using hybrid RSA-OAEP (buyer public key) + AES-256-GCM.
 */
export async function encryptBufferWithBuyerKey(plain: Buffer, buyerPublicKeyPemOrPath: string) {
  const pem = readPemMaybe(buyerPublicKeyPemOrPath);
  if (!pem) throw new Error('buyer public key PEM required');

  // Generate random AES-256 key
  const aesKey = crypto.randomBytes(32); // 256-bit
  const iv = crypto.randomBytes(12); // 96-bit recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Encrypt AES key with buyer RSA public key using OAEP-SHA256
  const encryptedKey = crypto.publicEncrypt(
    {
      key: pem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    aesKey,
  );

  // Optionally compute buyer key fingerprint (sha256 of public key)
  const buyerFingerprint = crypto.createHash('sha256').update(Buffer.from(pem, 'utf8')).digest('hex');

  return {
    encryptedData: Buffer.concat([iv, authTag, encrypted]), // store iv + tag + ciphertext
    encryptedKeyB64: encryptedKey.toString('base64'),
    ivB64: iv.toString('base64'),
    authTagB64: authTag.toString('base64'),
    algorithm: 'AES-256-GCM+RSA-OAEP-SHA256',
    buyerKeyFingerprint: buyerFingerprint,
  };
}

/**
 * Encrypt buffer using KMS-generated data key (GenerateDataKey). This function:
 *  - calls KMS GenerateDataKey to get a plaintext AES key + encrypted key
 *  - uses plaintext to encrypt artifact with AES-256-GCM
 *  - returns encryptedData and encryptedDataKey (base64)
 */
export async function encryptBufferWithKms(plain: Buffer, kmsKeyId: string) {
  if (!kmsKeyId) throw new Error('kmsKeyId is required for KMS encryption');

  const kmsRegion = process.env.AWS_REGION || 'us-east-1';
  const kmsClient = new KMSClient({ region: kmsRegion });

  // Request GenerateDataKey with AES_256
  const cmd = new GenerateDataKeyCommand({
    KeyId: kmsKeyId,
    KeySpec: 'AES_256',
  });

  const resp = await kmsClient.send(cmd as any);
  if (!resp.Plaintext || !resp.CiphertextBlob) {
    throw new Error('KMS GenerateDataKey failed to return keys');
  }

  const plaintextKey = Buffer.from(resp.Plaintext as Uint8Array);
  const encryptedDataKey = Buffer.from(resp.CiphertextBlob as Uint8Array); // binary

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', plaintextKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Zero plaintextKey ASAP
  try {
    plaintextKey.fill(0);
  } catch {
    // ignore
  }

  return {
    encryptedData: Buffer.concat([iv, authTag, encrypted]),
    encryptedDataKeyB64: encryptedDataKey.toString('base64'),
    ivB64: iv.toString('base64'),
    authTagB64: authTag.toString('base64'),
    algorithm: 'KMS:GenerateDataKey:AES-256-GCM',
    kmsKeyId,
  };
}

/**
 * Upload a Buffer to S3 (works with AWS S3 or MinIO)
 * Returns s3://bucket/key or throws on failure
 */
export async function uploadBufferToS3(buffer: Buffer, bucket: string, key: string) {
  if (!bucket || !key) throw new Error('bucket and key are required for S3 upload');

  // Configure S3 client using env vars (works for MinIO and AWS)
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const region = process.env.S3_REGION || 'us-east-1';
  const accessKey = process.env.S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY || process.env.S3_ACCESS_KEY_ID;
  const secretKey = process.env.S3_SECRET_ACCESS_KEY || process.env.S3_SECRET || process.env.S3_SECRET_ACCESS_KEY;

  const s3Client = new S3Client({
    region,
    endpoint,
    forcePathStyle: Boolean(endpoint), // true for MinIO
    credentials: accessKey && secretKey ? { accessKeyId: accessKey, secretAccessKey: secretKey } : undefined,
  });

  const put = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: 'application/octet-stream',
  });

  await s3Client.send(put as any);

  return `s3://${bucket}/${key}`;
}

/**
 * Create an encrypted delivery for an artifact.
 *
 * Options:
 *  - artifactBuffer: Buffer (required)
 *  - orderId, skuId: strings
 *  - buyerPublicKeyPem?: string (path or inline PEM)  // preferred for privacy
 *  - kmsKeyId?: string  // if provided, use KMS option
 *  - s3Bucket?: string (defaults to S3_BUCKET env)
 *  - s3KeyPrefix?: string (defaults to 'encrypted')
 *
 * Behavior:
 *  - If kmsKeyId provided or DELIVERY_KMS_KEY_ID env var present, uses KMS path.
 *  - Else if buyerPublicKeyPem provided, uses buyer-key path.
 *  - Uploads encrypted artifact to S3 and returns delivery metadata.
 */
export async function createEncryptedDelivery(opts: {
  artifactBuffer: Buffer;
  orderId?: string;
  skuId?: string;
  buyerPublicKeyPem?: string;
  kmsKeyId?: string;
  s3Bucket?: string;
  s3KeyPrefix?: string;
}) {
  if (!opts || !opts.artifactBuffer) throw new Error('artifactBuffer is required');

  const artifact = opts.artifactBuffer;
  const skuId = opts.skuId || 'unknown-sku';
  const orderId = opts.orderId || `order-${Date.now()}`;
  const s3Bucket = opts.s3Bucket || process.env.S3_BUCKET;
  if (!s3Bucket) throw new Error('S3_BUCKET is not configured');

  const s3KeyPrefix = opts.s3KeyPrefix || 'encrypted';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `${s3KeyPrefix}/${skuId}/${orderId}-${timestamp}.enc`;

  // Decide encryption method
  const kmsKeyId = opts.kmsKeyId || process.env.DELIVERY_KMS_KEY_ID || undefined;
  let keyProvenance: KeyProvenance | null = null;
  let encryptedData: Buffer;

  if (kmsKeyId) {
    // use KMS
    const kmsRes = await encryptBufferWithKms(artifact, kmsKeyId);
    encryptedData = kmsRes.encryptedData;
    keyProvenance = {
      method: 'kms',
      encrypted_data_key_b64: kmsRes.encryptedDataKeyB64,
      kms_key_id: kmsRes.kmsKeyId,
      algorithm: kmsRes.algorithm as KeyProvenance['algorithm'],
    };
  } else if (opts.buyerPublicKeyPem) {
    const buyerRes = await encryptBufferWithBuyerKey(artifact, opts.buyerPublicKeyPem);
    encryptedData = buyerRes.encryptedData;
    keyProvenance = {
      method: 'buyer-key',
      encrypted_key_b64: buyerRes.encryptedKeyB64,
      algorithm: buyerRes.algorithm as KeyProvenance['algorithm'],
      buyer_key_fingerprint: buyerRes.buyerKeyFingerprint,
    };
  } else {
    // No buyer key or KMS configured - fallback: encrypt with a locally generated ephemeral key (not secure for prod)
    const aesKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
    const encrypted = Buffer.concat([cipher.update(artifact), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // encrypt ephemeral key with a dev signer? Instead we will base64 the key (NOT SECURE). Mark provenance accordingly
    const ephemeralEncryptedKeyB64 = Buffer.from(aesKey).toString('base64');
    encryptedData = Buffer.concat([iv, authTag, encrypted]);
    keyProvenance = {
      method: 'buyer-key',
      encrypted_key_b64: ephemeralEncryptedKeyB64,
      algorithm: 'AES-256-GCM+ephemeral-insecure',
    } as any;
    // zero key
    try {
      aesKey.fill(0);
    } catch {}
  }

  // upload to S3
  const s3Uri = await uploadBufferToS3(encryptedData, s3Bucket, key);

  const artifactSha256 = crypto.createHash('sha256').update(artifact).digest('hex');

  const delivery = {
    delivery_id: `delivery-${crypto.createHash('sha256').update(`${orderId}:${key}`).digest('hex').slice(0, 12)}`,
    status: 'ready',
    encrypted_delivery_url: s3Uri,
    key_provenance: keyProvenance,
    artifact_sha256: artifactSha256,
  };

  return {
    s3Uri,
    delivery,
  };
}

export default {
  encryptBufferWithBuyerKey,
  encryptBufferWithKms,
  uploadBufferToS3,
  createEncryptedDelivery,
};

