/**
 * memory-layer/service/audit/kmsAdapter.ts
 *
 * Lightweight KMS/HSM adapter for audit signing and verification.
 *
 * Exports:
 *  - signAuditCanonical(canonical: string): Promise<{ kid, alg, signature }>
 *  - signAuditHash(digestBuf: Buffer): Promise<{ kid, alg, signature }>
 *  - verifySignature(signatureBase64: string, digestBuf: Buffer): Promise<boolean>
 *
 * Environment variables:
 *  - AUDIT_SIGNING_KMS_KEY_ID   (required for signing/verification)
 *  - AUDIT_SIGNING_ALG          (optional, defaults to "hmac-sha256")
 *  - AWS_REGION / AWS_DEFAULT_REGION (optional, default us-east-1)
 *
 * Notes:
 *  - Uses AWS KMS v3 client (@aws-sdk/client-kms).
 *  - Supports: HMAC (HMAC_SHA_256), RSA (RSASSA_PKCS1_V1_5_SHA_256), ED25519.
 *  - For HMAC: GenerateMac / VerifyMac are used.
 *  - For RSA: Sign with MessageType='DIGEST' for digest-path; Verify uses VerifyCommand.
 */

import { KMSClient, SignCommand, GenerateMacCommand, VerifyCommand, VerifyMacCommand } from '@aws-sdk/client-kms';

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const client = new KMSClient({ region });

function getKeyId(): string {
  const keyId = process.env.AUDIT_SIGNING_KMS_KEY_ID;
  if (!keyId) {
    throw new Error('AUDIT_SIGNING_KMS_KEY_ID is not set (required for KMS signing)');
  }
  return keyId;
}

function getAlg(): string {
  return (process.env.AUDIT_SIGNING_ALG || 'hmac-sha256').toLowerCase();
}

/**
 * Sign canonical payload (message path).
 * This mirrors a "message signing" semantics where KMS will hash internally when required.
 */
export async function signAuditCanonical(canonical: string): Promise<{ kid: string; alg: string; signature: string }> {
  const keyId = getKeyId();
  const alg = getAlg();
  const msgBuf = Buffer.from(canonical);

  if (alg === 'hmac-sha256' || alg === 'hmac') {
    const cmd = new GenerateMacCommand({
      KeyId: keyId,
      Message: msgBuf,
      MacAlgorithm: 'HMAC_SHA_256'
    });
    const resp = await client.send(cmd);
    if (!resp || !resp.Mac) throw new Error('KMS GenerateMac returned no Mac');
    return { kid: keyId, alg: 'hmac-sha256', signature: Buffer.from(resp.Mac).toString('base64') };
  }

  if (alg === 'rsa-sha256' || alg === 'rsa') {
    const cmd = new SignCommand({
      KeyId: keyId,
      Message: msgBuf,
      SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256'
      // MessageType omitted => KMS will hash the message internally
    });
    const resp = await client.send(cmd);
    if (!resp || !resp.Signature) throw new Error('KMS Sign returned no Signature');
    return { kid: keyId, alg: 'rsa-sha256', signature: Buffer.from(resp.Signature).toString('base64') };
  }

  if (alg === 'ed25519' || alg === 'ed25519-sha') {
    const cmd = new SignCommand({
      KeyId: keyId,
      Message: msgBuf,
      SigningAlgorithm: 'ED25519' as any
    });
    const resp = await client.send(cmd);
    if (!resp || !resp.Signature) throw new Error('KMS Sign returned no Signature');
    return { kid: keyId, alg: 'ed25519', signature: Buffer.from(resp.Signature).toString('base64') };
  }

  throw new Error(`Unsupported AUDIT_SIGNING_ALG for KMS adapter: ${alg}`);
}

/**
 * Sign precomputed 32-byte SHA-256 digest (digest path).
 * This is the preferred path for audit digest signing (no additional hashing).
 */
export async function signAuditHash(digestBuf: Buffer): Promise<{ kid: string; alg: string; signature: string }> {
  if (!Buffer.isBuffer(digestBuf)) throw new Error('digestBuf must be a Buffer');
  const keyId = getKeyId();
  const alg = getAlg();

  if (alg === 'hmac-sha256' || alg === 'hmac') {
    const cmd = new GenerateMacCommand({
      KeyId: keyId,
      Message: digestBuf,
      MacAlgorithm: 'HMAC_SHA_256'
    });
    const resp = await client.send(cmd);
    if (!resp || !resp.Mac) throw new Error('KMS GenerateMac returned no Mac');
    return { kid: keyId, alg: 'hmac-sha256', signature: Buffer.from(resp.Mac).toString('base64') };
  }

  if (alg === 'rsa-sha256' || alg === 'rsa') {
    // Use digest semantics so KMS does not re-hash
    const cmd = new SignCommand({
      KeyId: keyId,
      Message: digestBuf,
      SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
      MessageType: 'DIGEST'
    } as any); // MessageType is supported by KMS but typings might differ
    const resp = await client.send(cmd);
    if (!resp || !resp.Signature) throw new Error('KMS Sign returned no Signature');
    return { kid: keyId, alg: 'rsa-sha256', signature: Buffer.from(resp.Signature).toString('base64') };
  }

  if (alg === 'ed25519' || alg === 'ed25519-sha') {
    // ED25519 signs arbitrary bytes; pass digest buffer directly.
    const cmd = new SignCommand({
      KeyId: keyId,
      Message: digestBuf,
      SigningAlgorithm: 'ED25519' as any
      // MessageType left unset: KMS will sign the provided bytes
    });
    const resp = await client.send(cmd);
    if (!resp || !resp.Signature) throw new Error('KMS Sign returned no Signature');
    return { kid: keyId, alg: 'ed25519', signature: Buffer.from(resp.Signature).toString('base64') };
  }

  throw new Error(`Unsupported AUDIT_SIGNING_ALG for KMS adapter (digest path): ${alg}`);
}

/**
 * Verify a signature over a precomputed digest (digestBuf).
 * For HMAC: uses VerifyMacCommand.
 * For RSA/ED25519: uses VerifyCommand with MessageType='DIGEST' where applicable.
 */
export async function verifySignature(signatureBase64: string, digestBuf: Buffer): Promise<boolean> {
  if (!Buffer.isBuffer(digestBuf)) throw new Error('digestBuf must be a Buffer');
  const keyId = getKeyId();
  const alg = getAlg();
  const signatureBuf = Buffer.from(signatureBase64, 'base64');

  if (alg === 'hmac-sha256' || alg === 'hmac') {
    const cmd = new VerifyMacCommand({
      KeyId: keyId,
      Message: digestBuf,
      Mac: signatureBuf,
      MacAlgorithm: 'HMAC_SHA_256'
    } as any);
    const resp = await client.send(cmd);
    // VerifyMacCommand returns { MacValid: boolean } on success
    // but different SDK versions may return `MacValid` or `MacValid` under a different name; handle generically
    // (Type assertion used because @aws-sdk types can vary)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyResp: any = resp;
    return Boolean(anyResp?.MacValid);
  }

  if (alg === 'rsa-sha256' || alg === 'rsa') {
    const cmd = new VerifyCommand({
      KeyId: keyId,
      Message: digestBuf,
      Signature: signatureBuf,
      SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
      MessageType: 'DIGEST'
    } as any);
    const resp = await client.send(cmd);
    // VerifyCommand returns { SignatureValid: boolean }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyResp: any = resp;
    return Boolean(anyResp?.SignatureValid);
  }

  if (alg === 'ed25519' || alg === 'ed25519-sha') {
    const cmd = new VerifyCommand({
      KeyId: keyId,
      Message: digestBuf,
      Signature: signatureBuf,
      SigningAlgorithm: 'ED25519' as any
      // MessageType omitted (KMS treats message bytes as-is)
    } as any);
    const resp = await client.send(cmd);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyResp: any = resp;
    return Boolean(anyResp?.SignatureValid);
  }

  throw new Error(`Unsupported AUDIT_SIGNING_ALG for KMS adapter (verify): ${alg}`);
}

