// agent-manager/server/key_store.js
// Pluggable key provider / KMS adapter (local dev + simple remote)
// Extended to provide signAuditHash(hash) for digest signing semantics.
//
// Exports:
//  - getAuditSigningKey() -> { kid, alg, key }  (key is string or PEM or null for KMS)
//  - getKernelPublicKeys() -> { kid: { alg, key }, ... }
//  - signAuditCanonical(canonical) -> { kid, alg, signature } (base64)
//  - signAuditHash(hash) -> { kid, alg, signature } (base64)  <-- NEW
//
// Configuration (env):
//  - AUDIT_SIGNING_KEY_SOURCE: "env" | "file" | "url" | "kms" (default: env)
//  - AUDIT_SIGNING_PRIVATE_KEY: (used for env source — raw secret or PEM)
//  - AUDIT_SIGNING_KEY_PATH: (used for file source)
//  - AUDIT_SIGNING_ALG: 'hmac-sha256' | 'rsa-sha256' | 'ed25519' (default: hmac-sha256)
//  - AUDIT_SIGNER_KID: key id string (default: 'local')
//  - KERNEL_PUBLIC_KEYS_JSON: JSON string mapping kid -> { alg, key } (preferred)
//  - KERNEL_PUBLIC_KEYS_PATH: file path to JSON with same shape
//  - KERNEL_PUBLIC_KEYS_URL: URL returning same JSON shape (fetched)
//  - KERNEL_SHARED_SECRET: fallback secret (shared hmac) if none supplied

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let kmsAdapter = null;
try {
  kmsAdapter = require('./key_store_kms_adapter');
} catch (e) {
  // KMS adapter may not be installed in dev. We'll gracefully fall back.
  kmsAdapter = null;
}

async function tryReadFileUtf8(p) {
  return new Promise((resolve, reject) => {
    fs.readFile(p, 'utf8', (err, s) => {
      if (err) return reject(err);
      resolve(s);
    });
  });
}

/* ---------- Audit signing key retrieval ---------- */

async function getAuditSigningKeyFromEnv() {
  const key = process.env.AUDIT_SIGNING_PRIVATE_KEY || null;
  if (!key) return null;
  const alg = (process.env.AUDIT_SIGNING_ALG || 'hmac-sha256').toLowerCase();
  const kid = process.env.AUDIT_SIGNER_KID || 'local';
  return { kid, alg, key };
}

async function getAuditSigningKeyFromFile() {
  const p = process.env.AUDIT_SIGNING_KEY_PATH || path.join(process.cwd(), 'secrets', 'audit_signing_key.pem');
  try {
    const raw = await tryReadFileUtf8(p);
    const alg = (process.env.AUDIT_SIGNING_ALG || 'rsa-sha256').toLowerCase();
    const kid = process.env.AUDIT_SIGNER_KID || path.basename(p);
    return { kid, alg, key: raw };
  } catch (e) {
    // file not present or unreadable
    return null;
  }
}

async function getAuditSigningKeyFromUrl() {
  const url = process.env.AUDIT_SIGNING_KEY_URL;
  if (!url) return null;
  try {
    if (typeof globalThis.fetch !== 'function') throw new Error('fetch not available');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`failed fetching key: ${resp.status}`);
    const json = await resp.json();
    const kid = json.kid || process.env.AUDIT_SIGNER_KID || 'remote';
    const alg = (json.alg || process.env.AUDIT_SIGNING_ALG || 'rsa-sha256').toLowerCase();
    return { kid, alg, key: json.key };
  } catch (e) {
    return null;
  }
}

async function getAuditSigningKeyFromKms() {
  // If using KMS, we cannot return key material. Return kid/alg so caller knows which key is used.
  const kid = process.env.AUDIT_SIGNING_KMS_KEY_ID || null;
  if (!kid) return null;
  const alg = (process.env.AUDIT_SIGNING_ALG || 'hmac-sha256').toLowerCase();
  return { kid, alg, key: null };
}

/**
 * getAuditSigningKey
 * Tries configured sources in order and returns the first available key info.
 */
async function getAuditSigningKey() {
  const src = (process.env.AUDIT_SIGNING_KEY_SOURCE || 'env').toLowerCase();
  if (src === 'env') {
    const k = await getAuditSigningKeyFromEnv();
    if (k) return k;
    const kf = await getAuditSigningKeyFromFile();
    if (kf) return kf;
    const ku = await getAuditSigningKeyFromUrl();
    if (ku) return ku;
    return null;
  }
  if (src === 'file') {
    const kf = await getAuditSigningKeyFromFile();
    if (kf) return kf;
    return await getAuditSigningKeyFromEnv();
  }
  if (src === 'url') {
    const ku = await getAuditSigningKeyFromUrl();
    if (ku) return ku;
    const ke = await getAuditSigningKeyFromEnv();
    if (ke) return ke;
    return await getAuditSigningKeyFromFile();
  }
  if (src === 'kms' || src === 'aws-kms') {
    const kk = await getAuditSigningKeyFromKms();
    if (kk) return kk;
    // fall back to env/file/url if KMS not configured
    const ke = await getAuditSigningKeyFromEnv();
    if (ke) return ke;
    const kf = await getAuditSigningKeyFromFile();
    if (kf) return kf;
    return null;
  }
  // unknown source: try env
  return await getAuditSigningKeyFromEnv();
}

/* ---------- Kernel public keys retrieval ---------- */

async function getKernelPublicKeysFromJsonEnv() {
  if (!process.env.KERNEL_PUBLIC_KEYS_JSON) return null;
  try {
    const parsed = JSON.parse(process.env.KERNEL_PUBLIC_KEYS_JSON);
    return parsed;
  } catch (e) {
    return null;
  }
}

async function getKernelPublicKeysFromFile() {
  const p = process.env.KERNEL_PUBLIC_KEYS_PATH || path.join(process.cwd(), 'secrets', 'kernel_public_keys.json');
  try {
    const raw = await tryReadFileUtf8(p);
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function getKernelPublicKeysFromUrl() {
  const url = process.env.KERNEL_PUBLIC_KEYS_URL;
  if (!url) return null;
  try {
    if (typeof globalThis.fetch !== 'function') throw new Error('fetch not available');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`failed fetching keys: ${resp.status}`);
    const json = await resp.json();
    return json;
  } catch (e) {
    return null;
  }
}

async function getKernelPublicKeys() {
  // 1) env JSON
  const j = await getKernelPublicKeysFromJsonEnv();
  if (j) return j;

  // 2) file
  const f = await getKernelPublicKeysFromFile();
  if (f) return f;

  // 3) url
  const u = await getKernelPublicKeysFromUrl();
  if (u) return u;

  // 4) fallback shared secret
  if (process.env.KERNEL_SHARED_SECRET) {
    return { shared: { alg: 'hmac-sha256', key: process.env.KERNEL_SHARED_SECRET } };
  }

  return {};
}

/* ---------- Signing helper backed by configured provider ---------- */

/**
 * Helper: normalize hash input to Buffer.
 * Accepts Buffer or hex/base64 string.
 */
function normalizeHashInput(hash) {
  if (!hash) throw new Error('hash is required');
  if (Buffer.isBuffer(hash)) return hash;
  if (typeof hash === 'string') {
    if (/^[0-9a-fA-F]+$/.test(hash) && (hash.length === 64)) {
      return Buffer.from(hash, 'hex');
    }
    if (/^[A-Za-z0-9+/=]+$/.test(hash)) {
      return Buffer.from(hash, 'base64');
    }
  }
  throw new Error('Unsupported hash input type — provide a Buffer or hex/base64 string');
}

/**
 * signAuditHash(hash)
 * - hash: Buffer or hex/base64 string of the 32-byte SHA-256 digest to sign
 * Returns: { kid, alg, signature }  (signature is base64 string) or { kid, alg, signature: null } if unsigned
 */
async function signAuditHash(hash) {
  const hashBuf = normalizeHashInput(hash);

  // Try KMS adapter digest signing first if configured
  const src = (process.env.AUDIT_SIGNING_KEY_SOURCE || 'env').toLowerCase();
  const keyInfo = await getAuditSigningKey();
  const configuredKid = (keyInfo && keyInfo.kid) ? keyInfo.kid : (process.env.AUDIT_SIGNER_KID || null);
  const alg = (keyInfo && keyInfo.alg) ? keyInfo.alg.toLowerCase() : ((process.env.AUDIT_SIGNING_ALG || 'hmac-sha256').toLowerCase());
  const kid = configuredKid || null;

  // 1) KMS path via adapter (adapter should implement signAuditHash for digest semantics)
  if ((src === 'kms' || src === 'aws-kms') && kmsAdapter && typeof kmsAdapter.signAuditHash === 'function') {
    return await kmsAdapter.signAuditHash(hashBuf);
  }

  // 2) If KMS is configured but adapter doesn't expose signAuditHash, attempt to call adapter.signAuditCanonical?
  //    We do NOT want to sign canonical here; that would be a different shape. So if adapter lacks digest-signing
  //    support, prefer to defer to local helper or return unsigned marker.
  if ((src === 'kms' || src === 'aws-kms') && kmsAdapter && typeof kmsAdapter.signAuditHash !== 'function') {
    // If adapter exposes signAuditCanonical only, we refuse to use it here because it signs message not digest.
    // Return a marker indicating KMS is expected but signing not available locally (caller should fallback).
    return { kid, alg, signature: null };
  }

  // 3) Local key material signing (env/file/url)
  if (keyInfo && keyInfo.key) {
    const keyMaterial = keyInfo.key;
    if (alg === 'hmac-sha256') {
      const sig = crypto.createHmac('sha256', keyMaterial).update(hashBuf).digest('base64');
      return { kid, alg: 'hmac-sha256', signature: sig };
    }
    if (alg === 'ed25519') {
      // Node's crypto.sign with null alg uses Ed25519 when key is Ed25519 keypair PEM
      const sig = crypto.sign(null, hashBuf, keyMaterial).toString('base64');
      return { kid, alg: 'ed25519', signature: sig };
    }
    if (alg === 'rsa-sha256' || alg === 'rsa') {
      // Wrap digest in DigestInfo for PKCS#1 v1.5 and perform private-key operation
      const SHA256_DIGESTINFO_PREFIX_HEX = '3031300d060960864801650304020105000420';
      const SHA256_DIGESTINFO_PREFIX = Buffer.from(SHA256_DIGESTINFO_PREFIX_HEX, 'hex');
      const toSign = Buffer.concat([SHA256_DIGESTINFO_PREFIX, hashBuf]);

      // Use privateEncrypt (RSA private operation) with PKCS1 padding to generate signature buffer.
      const signatureBuf = crypto.privateEncrypt(
        { key: keyMaterial, padding: crypto.constants.RSA_PKCS1_PADDING },
        toSign
      );

      return { kid, alg: 'rsa-sha256', signature: signatureBuf.toString('base64') };
    }
    throw new Error(`Unsupported local signing alg: ${alg}`);
  }

  // 4) Fallback: if no key material and no KMS adapter, attempt env fallbacks (already covered above)
  // If nothing available, return unsigned marker
  return { kid, alg, signature: null };
}

/* ---------- Existing signAuditCanonical retained for message signing path ---------- */
async function signAuditCanonical(canonical) {
  const src = (process.env.AUDIT_SIGNING_KEY_SOURCE || 'env').toLowerCase();

  // 1) If using KMS and a KMS adapter is available, delegate signing to it.
  if ((src === 'kms' || src === 'aws-kms') && kmsAdapter && typeof kmsAdapter.signAuditCanonical === 'function') {
    return await kmsAdapter.signAuditCanonical(canonical);
  }

  // 2) Otherwise, fall back to local / env / file / url behavior (existing behavior).
  const keyInfo = await getAuditSigningKey();
  if (!keyInfo) {
    // No key known; return null to indicate unsigned.
    return null;
  }
  const alg = (keyInfo.alg || 'hmac-sha256').toLowerCase();
  const kid = keyInfo.kid || (process.env.AUDIT_SIGNER_KID || 'local');
  const keyMaterial = keyInfo.key;

  if (!keyMaterial) {
    // No key material (likely KMS), signal null.
    return { kid, alg, signature: null };
  }

  if (alg === 'hmac-sha256') {
    const sig = crypto.createHmac('sha256', keyMaterial).update(Buffer.from(canonical)).digest('base64');
    return { kid, alg, signature: sig };
  }
  if (alg === 'rsa-sha256' || alg === 'rsa') {
    const sig = crypto.sign('sha256', Buffer.from(canonical), keyMaterial).toString('base64');
    return { kid, alg: 'rsa-sha256', signature: sig };
  }
  if (alg === 'ed25519') {
    const sig = crypto.sign(null, Buffer.from(canonical), keyMaterial).toString('base64');
    return { kid, alg: 'ed25519', signature: sig };
  }
  throw new Error(`Unsupported audit signing alg: ${alg}`);
}

module.exports = {
  getAuditSigningKey,
  getKernelPublicKeys,
  signAuditCanonical,
  signAuditHash
};

