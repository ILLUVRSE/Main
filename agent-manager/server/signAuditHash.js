// agent-manager/server/signAuditHash.js
// Helper to sign a SHA-256 hash (digest) for audit events.
// Exposes: signAuditHash(hash) -> { kid, alg, signature } where signature is base64.
//
// Behavior:
//  - If AUDIT_SIGNING_KEY_SOURCE is 'kms' (or KMS key is configured), attempts to call AWS KMS
//    to sign the digest (or generate MAC for HMAC keys). Uses DIGEST semantics where appropriate.
//  - Otherwise, uses local/private-key or env-based keys (via getAuditSigningKey).
//  - Accepts `hash` as a Buffer or a hex string (hex is common).
//
// NOTE: This file intentionally keeps provider semantics explicit and unit-testable.
//
// Security note: callers must ensure `hash` is the exact bytes to sign (for our flow,
// that will be SHA256(canonical || prevHashBytes)).

const crypto = require('crypto');
const keyStore = require('./key_store');

const AWS_KMS_CLIENT_MODULE = '@aws-sdk/client-kms';

// DigestInfo prefix for SHA-256 (ASN.1)
// DER: SEQUENCE{SEQUENCE{OID sha256} NULL} OCTET STRING(32)
// Hex prefix used for PKCS#1 v1.5 digestInfo wrapping
const SHA256_DIGESTINFO_PREFIX_HEX = '3031300d060960864801650304020105000420';
const SHA256_DIGESTINFO_PREFIX = Buffer.from(SHA256_DIGESTINFO_PREFIX_HEX, 'hex');

function normalizeHashInput(hash) {
  if (!hash) throw new Error('hash is required');
  if (Buffer.isBuffer(hash)) return hash;
  if (typeof hash === 'string') {
    // if looks like hex
    if (/^[0-9a-fA-F]+$/.test(hash)) {
      return Buffer.from(hash, 'hex');
    }
    // fallback: treat as base64 if it contains base64 chars
    if (/^[A-Za-z0-9+/=]+$/.test(hash)) {
      return Buffer.from(hash, 'base64');
    }
  }
  throw new Error('Unsupported hash input type — provide a Buffer or hex/base64 string');
}

function signWithLocalHmac(hashBuf, keyMaterial) {
  const sig = crypto.createHmac('sha256', keyMaterial).update(hashBuf).digest('base64');
  return sig;
}

function signWithLocalEd25519(hashBuf, keyMaterial) {
  // Existing codebase uses `crypto.sign(null, message, key)` for ed25519.
  // Using the digest as the message is consistent with the new flow.
  const sig = crypto.sign(null, hashBuf, keyMaterial).toString('base64');
  return sig;
}

function signWithLocalRsaDigest(hashBuf, keyMaterial) {
  // For RSA PKCS#1 v1.5 we need to wrap the SHA-256 digest in the ASN.1 DigestInfo structure
  // and then perform the private-key operation with PKCS#1 v1.5 padding.
  // Using crypto.privateEncrypt (private-key operation) with RSA_PKCS1_PADDING produces the
  // expected RSASSA-PKCS1-v1_5 signature.
  const toSign = Buffer.concat([SHA256_DIGESTINFO_PREFIX, hashBuf]);

  // Node provides crypto.privateEncrypt which performs the private key operation (sign).
  // Use explicit padding constant to be clear.
  const signatureBuf = crypto.privateEncrypt(
    { key: keyMaterial, padding: crypto.constants.RSA_PKCS1_PADDING },
    toSign
  );

  return signatureBuf.toString('base64');
}

/**
 * signAuditHash(hash)
 * - hash: Buffer or hex/base64 string of the 32-byte SHA-256 digest to sign
 * Returns: { kid, alg, signature }  (signature is base64 string)
 */
async function signAuditHash(hash) {
  const hashBuf = normalizeHashInput(hash);

  // Determine configured key info (may return kid/alg/key or only kid/alg when KMS)
  const keyInfo = await keyStore.getAuditSigningKey();

  const src = (process.env.AUDIT_SIGNING_KEY_SOURCE || 'env').toLowerCase();
  const alg = (keyInfo && keyInfo.alg) ? keyInfo.alg.toLowerCase() : ((process.env.AUDIT_SIGNING_ALG || 'hmac-sha256').toLowerCase());
  const kid = (keyInfo && keyInfo.kid) ? keyInfo.kid : (process.env.AUDIT_SIGNER_KID || null);

  // 1) If we have local key material (env/file/url), sign locally.
  if (keyInfo && keyInfo.key) {
    const keyMaterial = keyInfo.key;
    if (alg === 'hmac-sha256') {
      const signature = signWithLocalHmac(hashBuf, keyMaterial);
      return { kid, alg: 'hmac-sha256', signature };
    }
    if (alg === 'ed25519') {
      const signature = signWithLocalEd25519(hashBuf, keyMaterial);
      return { kid, alg: 'ed25519', signature };
    }
    if (alg === 'rsa-sha256' || alg === 'rsa') {
      const signature = signWithLocalRsaDigest(hashBuf, keyMaterial);
      return { kid, alg: 'rsa-sha256', signature };
    }
    throw new Error(`Unsupported local signing alg: ${alg}`);
  }

  // 2) Otherwise, if KMS is requested (or keyInfo indicates a KMS key), attempt KMS signing:
  const kmsKeyId = process.env.AUDIT_SIGNING_KMS_KEY_ID || (keyInfo && keyInfo.kid);
  if ((src === 'kms' || src === 'aws-kms' || kmsKeyId) ) {
    // try to load AWS KMS SDK (if not present, surface a clear error)
    let KMSClient, SignCommand, GenerateMacCommand;
    try {
      const kmsMod = require(AWS_KMS_CLIENT_MODULE);
      KMSClient = kmsMod.KMSClient;
      SignCommand = kmsMod.SignCommand;
      GenerateMacCommand = kmsMod.GenerateMacCommand;
    } catch (e) {
      // SDK not installed or not available: surface a helpful message.
      throw new Error(`${AWS_KMS_CLIENT_MODULE} is required for KMS signing but was not found. Install it or configure a local key. (${e.message})`);
    }

    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    const client = new KMSClient({ region });

    if (!kmsKeyId) {
      throw new Error('AUDIT_SIGNING_KMS_KEY_ID is not set (required for KMS signing)');
    }

    if (alg === 'hmac-sha256') {
      // GenerateMac with the precomputed digest as the Message
      const cmd = new GenerateMacCommand({
        KeyId: kmsKeyId,
        Message: hashBuf,
        MacAlgorithm: 'HMAC_SHA_256'
      });
      const resp = await client.send(cmd);
      if (!resp || !resp.Mac) throw new Error('KMS GenerateMac returned no Mac');
      return { kid: kmsKeyId, alg: 'hmac-sha256', signature: Buffer.from(resp.Mac).toString('base64') };
    }

    if (alg === 'rsa-sha256' || alg === 'rsa') {
      // Sign using the digest (MessageType: 'DIGEST') so KMS doesn't re-hash.
      const params = {
        KeyId: kmsKeyId,
        Message: hashBuf,
        SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
        /* MessageType can be set to 'DIGEST' to indicate we passed a digest. */
        MessageType: 'DIGEST'
      };
      const cmd = new SignCommand(params);
      const resp = await client.send(cmd);
      if (!resp || !resp.Signature) throw new Error('KMS Sign returned no Signature');
      return { kid: kmsKeyId, alg: 'rsa-sha256', signature: Buffer.from(resp.Signature).toString('base64') };
    }

    if (alg === 'ed25519') {
      // For Ed25519 we pass the digest bytes as the "message" (signature semantics are byte-oriented)
      const params = {
        KeyId: kmsKeyId,
        Message: hashBuf,
        SigningAlgorithm: 'ED25519'
      };
      const cmd = new SignCommand(params);
      const resp = await client.send(cmd);
      if (!resp || !resp.Signature) throw new Error('KMS Sign returned no Signature');
      return { kid: kmsKeyId, alg: 'ed25519', signature: Buffer.from(resp.Signature).toString('base64') };
    }

    throw new Error(`Unsupported KMS signing alg: ${alg}`);
  }

  // 3) No key material and no KMS -> unsigned
  return { kid: kid || null, alg, signature: null };
}

module.exports = {
  signAuditHash
};

