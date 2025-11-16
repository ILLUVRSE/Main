/**
 * memory-layer/service/audit/kmsAdapter.ts
 *
 * KMS adapter for audit signing and verification using AWS SDK v3.
 *
 * Exports:
 *  - signAuditCanonical(canonical: string): Promise<{ kid, alg, signature }>
 *  - signAuditHash(digestBuf: Buffer): Promise<{ kid, alg, signature }>
 *  - verifySignature(signatureBase64: string, digestBuf: Buffer): Promise<boolean>
 *
 * Behavior & notes:
 *  - Prefers digest-path signing for audit (caller computes SHA-256 digest and passes it).
 *  - Supports HMAC (HMAC_SHA_256 via GenerateMac/VerifyMac), RSA (RSASSA_PKCS1_V1_5_SHA_256),
 *    and ED25519 (if supported by the KMS account/region).
 *  - Uses small runtime mapping helpers (kmsAdapter.types) so we avoid scattered string literals.
 *  - Throws helpful errors on misconfiguration (missing AUDIT_SIGNING_KMS_KEY_ID).
 *
 * Environment variables:
 *  - AUDIT_SIGNING_KMS_KEY_ID  (required when using KMS signing)
 *  - AUDIT_SIGNING_ALG         (optional; defaults to "hmac-sha256")
 *  - AWS_REGION / AWS_DEFAULT_REGION
 */

import { KMSClient, SignCommand, GenerateMacCommand, VerifyCommand, VerifyMacCommand } from '@aws-sdk/client-kms';
import { normalizeAlg, kmsParamsForAlg, KMS_ALGS, KMS_MESSAGE_TYPES } from './kmsAdapter.types';
import { Buffer } from 'buffer';

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

/**
 * Lazily created KMS client
 */
let kmsClient: KMSClient | null = null;
function getKmsClient(): KMSClient {
  if (!kmsClient) kmsClient = new KMSClient({ region });
  return kmsClient;
}

function getKeyId(): string {
  const keyId = process.env.AUDIT_SIGNING_KMS_KEY_ID || process.env.AUDIT_SIGNING_KMS_KEY;
  if (!keyId) {
    throw new Error('AUDIT_SIGNING_KMS_KEY_ID (or AUDIT_SIGNING_KMS_KEY) is required for KMS signing');
  }
  return keyId;
}

function getNormalizedAlg(): 'hmac-sha256' | 'rsa-sha256' | 'ed25519' {
  const env = process.env.AUDIT_SIGNING_ALG ?? 'hmac-sha256';
  return normalizeAlg(env);
}

/**
 * Sign canonical: convenience wrapper that hashes canonical payload and signs the digest.
 */
export async function signAuditCanonical(canonical: string): Promise<{ kid: string; alg: string; signature: string }> {
  if (canonical === null || canonical === undefined) throw new Error('canonical required');
  const digest = Buffer.from(require('crypto').createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest());
  return signAuditHash(digest);
}

/**
 * Sign precomputed digest buffer (32-byte SHA-256 digest).
 */
export async function signAuditHash(digestBuf: Buffer): Promise<{ kid: string; alg: string; signature: string }> {
  if (!Buffer.isBuffer(digestBuf)) throw new Error('digestBuf must be a Buffer');
  const keyId = getKeyId();
  const alg = getNormalizedAlg();

  const client = getKmsClient();

  if (alg === 'hmac-sha256') {
    // HMAC path
    const macAlg = kmsParamsForAlg(alg).macAlgorithm ?? KMS_ALGS.HMAC_SHA_256;
    const cmd = new GenerateMacCommand({
      KeyId: keyId,
      Message: digestBuf,
      MacAlgorithm: macAlg
    });
    const resp = await client.send(cmd);
    if (!resp || !resp.Mac) throw new Error('KMS GenerateMac returned no Mac');
    return { kid: keyId, alg: 'hmac-sha256', signature: Buffer.from(resp.Mac).toString('base64') };
  }

  if (alg === 'rsa-sha256') {
    // RSA digest semantics: MessageType = 'DIGEST'
    const signingAlg = kmsParamsForAlg(alg).signingAlgorithm ?? KMS_ALGS.RSASSA_PKCS1_V1_5_SHA_256;
    const cmd = new SignCommand({
      KeyId: keyId,
      Message: digestBuf,
      SigningAlgorithm: signingAlg,
      MessageType: KMS_MESSAGE_TYPES.DIGEST as any
    } as any);
    const resp = await client.send(cmd);
    if (!resp || !resp.Signature) throw new Error('KMS Sign returned no Signature');
    return { kid: keyId, alg: 'rsa-sha256', signature: Buffer.from(resp.Signature).toString('base64') };
  }

  if (alg === 'ed25519') {
    const signingAlg = kmsParamsForAlg(alg).signingAlgorithm ?? KMS_ALGS.ED25519;
    // ED25519 expects bytes; we pass digestBuf (32 bytes) - acceptable as "message"
    const cmd = new SignCommand({
      KeyId: keyId,
      Message: digestBuf,
      SigningAlgorithm: signingAlg
    } as any);
    const resp = await client.send(cmd);
    if (!resp || !resp.Signature) throw new Error('KMS Sign returned no Signature');
    return { kid: keyId, alg: 'ed25519', signature: Buffer.from(resp.Signature).toString('base64') };
  }

  throw new Error(`Unsupported AUDIT_SIGNING_ALG: ${alg}`);
}

/**
 * Verify a signature (base64) against a precomputed digest buffer.
 */
export async function verifySignature(signatureBase64: string, digestBuf: Buffer): Promise<boolean> {
  if (!signatureBase64) throw new Error('signatureBase64 is required');
  if (!Buffer.isBuffer(digestBuf)) throw new Error('digestBuf must be a Buffer');

  const keyId = getKeyId();
  const alg = getNormalizedAlg();
  const client = getKmsClient();
  const sigBuf = Buffer.from(signatureBase64, 'base64');

  if (alg === 'hmac-sha256') {
    const macAlg = kmsParamsForAlg(alg).macAlgorithm ?? KMS_ALGS.HMAC_SHA_256;
    const cmd = new VerifyMacCommand({
      KeyId: keyId,
      Message: digestBuf,
      Mac: sigBuf,
      MacAlgorithm: macAlg
    } as any);
    const resp = await client.send(cmd);
    // VerifyMac returns MacValid in some SDK versions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyResp: any = resp;
    return Boolean(anyResp?.MacValid);
  }

  if (alg === 'rsa-sha256') {
    const signingAlg = kmsParamsForAlg(alg).signingAlgorithm ?? KMS_ALGS.RSASSA_PKCS1_V1_5_SHA_256;
    const cmd = new VerifyCommand({
      KeyId: keyId,
      Message: digestBuf,
      Signature: sigBuf,
      SigningAlgorithm: signingAlg,
      MessageType: KMS_MESSAGE_TYPES.DIGEST as any
    } as any);
    const resp = await client.send(cmd);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyResp: any = resp;
    return Boolean(anyResp?.SignatureValid);
  }

  if (alg === 'ed25519') {
    const signingAlg = kmsParamsForAlg(alg).signingAlgorithm ?? KMS_ALGS.ED25519;
    const cmd = new VerifyCommand({
      KeyId: keyId,
      Message: digestBuf,
      Signature: sigBuf,
      SigningAlgorithm: signingAlg
    } as any);
    const resp = await client.send(cmd);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyResp: any = resp;
    return Boolean(anyResp?.SignatureValid);
  }

  throw new Error(`Unsupported AUDIT_SIGNING_ALG for verify: ${alg}`);
}

export default {
  signAuditCanonical,
  signAuditHash,
  verifySignature
};

