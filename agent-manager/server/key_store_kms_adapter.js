// agent-manager/server/key_store_kms_adapter.js
// Adapter that uses AWS KMS to sign canonical audit payloads.
// Supports:
//  - HMAC (GenerateMac) when AUDIT_SIGNING_ALG = "hmac-sha256" and KeyId points to HMAC key
//  - RSA-SHA256 (Sign) when AUDIT_SIGNING_ALG = "rsa-sha256" and KeyId is RSA key
//  - ED25519 (Sign) when AUDIT_SIGNING_ALG = "ed25519" and KeyId is Ed25519 asymmetric key
//
// Required env:
//  - AUDIT_SIGNING_KMS_KEY_ID  (KMS KeyId or ARN)
//  - AWS_REGION or AWS_DEFAULT_REGION (optional; defaults to us-east-1)
//
// NOTE: this requires @aws-sdk/client-kms to be installed and AWS credentials to be available
// via env / ~/.aws/credentials / IAM role. This adapter returns base64 signatures.

const { KMSClient, SignCommand, GenerateMacCommand } = require('@aws-sdk/client-kms');

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const client = new KMSClient({ region });

async function signAuditCanonicalWithKms(canonical) {
  const keyId = process.env.AUDIT_SIGNING_KMS_KEY_ID;
  if (!keyId) {
    throw new Error('AUDIT_SIGNING_KMS_KEY_ID is not set (required for KMS signing)');
  }

  const alg = (process.env.AUDIT_SIGNING_ALG || 'hmac-sha256').toLowerCase();

  if (alg === 'hmac-sha256') {
    // Generate MAC using a symmetric HMAC key in KMS
    const cmd = new GenerateMacCommand({
      KeyId: keyId,
      Message: Buffer.from(canonical),
      MacAlgorithm: 'HMAC_SHA_256'
    });
    const resp = await client.send(cmd);
    if (!resp || !resp.Mac) throw new Error('KMS GenerateMac returned no Mac');
    return { kid: keyId, alg: 'hmac-sha256', signature: Buffer.from(resp.Mac).toString('base64') };
  }

  if (alg === 'rsa-sha256' || alg === 'rsa') {
    // Sign with RSA PKCS#1 v1.5 + SHA-256
    const cmd = new SignCommand({
      KeyId: keyId,
      Message: Buffer.from(canonical),
      SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256'
    });
    const resp = await client.send(cmd);
    if (!resp || !resp.Signature) throw new Error('KMS Sign returned no Signature');
    return { kid: keyId, alg: 'rsa-sha256', signature: Buffer.from(resp.Signature).toString('base64') };
  }

  if (alg === 'ed25519' || alg === 'ed25519-sha') {
    // Sign with ED25519
    const cmd = new SignCommand({
      KeyId: keyId,
      Message: Buffer.from(canonical),
      SigningAlgorithm: 'ED25519'
    });
    const resp = await client.send(cmd);
    if (!resp || !resp.Signature) throw new Error('KMS Sign returned no Signature');
    return { kid: keyId, alg: 'ed25519', signature: Buffer.from(resp.Signature).toString('base64') };
  }

  throw new Error(`Unsupported AUDIT_SIGNING_ALG for KMS adapter: ${alg}`);
}

module.exports = {
  signAuditCanonical: signAuditCanonicalWithKms
};

