/**
 * memory-layer/service/audit/mockSigner.ts
 *
 * Lightweight deterministic mock signer used for tests and local CI when a real
 * KMS or signing-proxy is not available.
 *
 * Exports (async):
 *  - signAuditCanonical(canonical: string): Promise<{ kid, alg, signature }>
 *  - signAuditHash(digestBuf: Buffer): Promise<{ kid, alg, signature }>
 *  - verifySignature(signatureBase64: string, digestBuf: Buffer): Promise<boolean>
 *
 * Behavior:
 *  - Uses HMAC-SHA256 with a test key from env var MOCK_AUDIT_SIGNING_KEY (hex or utf8).
 *  - If MOCK_AUDIT_SIGNING_KEY is not set, falls back to a fixed key (acceptable in CI/dev tests).
 *  - signAuditCanonical computes SHA-256(canonical) and then signs that digest (digest-path).
 *  - Signatures are returned as base64 strings; kid is "mock" and alg is "hmac-sha256".
 *
 * IMPORTANT: This module is for test/dev only. Do NOT use in production.
 */

import crypto from 'node:crypto';

const DEFAULT_KEY = 'mock-local-signing-key-do-not-use-in-prod';

function getSigningKey(): Buffer {
  const envKey = process.env.MOCK_AUDIT_SIGNING_KEY;
  if (!envKey) {
    return Buffer.from(DEFAULT_KEY, 'utf8');
  }
  // If envKey looks like hex (all hex chars and even length), accept it as hex.
  const hexMatch = /^[0-9a-fA-F]+$/;
  if (hexMatch.test(envKey) && envKey.length % 2 === 0) {
    return Buffer.from(envKey, 'hex');
  }
  return Buffer.from(envKey, 'utf8');
}

function computeHmacSha256(digestBuf: Buffer): Buffer {
  const key = getSigningKey();
  return crypto.createHmac('sha256', key).update(digestBuf).digest();
}

/**
 * Sign a canonical payload string (message path) by hashing it with SHA-256
 * and then computing HMAC-SHA256 over the digest. Returns base64 signature.
 */
export async function signAuditCanonical(canonical: string): Promise<{ kid: string; alg: string; signature: string }> {
  if (canonical === null || canonical === undefined) throw new Error('canonical is required');
  const digest = crypto.createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest(); // Buffer
  const mac = computeHmacSha256(digest);
  return { kid: 'mock', alg: 'hmac-sha256', signature: mac.toString('base64') };
}

/**
 * Sign a precomputed digest buffer (digest-path). Accepts a Buffer (32-byte SHA-256 digest).
 */
export async function signAuditHash(digestBuf: Buffer): Promise<{ kid: string; alg: string; signature: string }> {
  if (!Buffer.isBuffer(digestBuf)) throw new Error('digestBuf must be a Buffer');
  const mac = computeHmacSha256(digestBuf);
  return { kid: 'mock', alg: 'hmac-sha256', signature: mac.toString('base64') };
}

/**
 * Verify a signature (base64) against a precomputed digest buffer.
 */
export async function verifySignature(signatureBase64: string, digestBuf: Buffer): Promise<boolean> {
  if (!signatureBase64) throw new Error('signatureBase64 required');
  if (!Buffer.isBuffer(digestBuf)) throw new Error('digestBuf must be a Buffer');

  const expectedMac = computeHmacSha256(digestBuf);
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(signatureBase64, 'base64');
  } catch (err) {
    return false;
  }

  if (sigBuf.length !== expectedMac.length) {
    // avoid timingSafeEqual throwing on length mismatch
    return false;
  }

  try {
    return crypto.timingSafeEqual(expectedMac, sigBuf);
  } catch (err) {
    return false;
  }
}

export default {
  signAuditCanonical,
  signAuditHash,
  verifySignature
};

