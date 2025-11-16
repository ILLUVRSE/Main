/**
 * memory-layer/service/audit/auditChain.ts
 *
 * Canonicalization, digest computation, and audit signing utilities.
 *
 * Exports:
 *  - canonicalizePayload(value: unknown): string
 *  - computeAuditDigest(canonicalPayload: string, prevHashHex: string | null): string
 *  - signAuditDigest(digestHex: string): Promise<string | null>   // preferred async signer
 *  - signAuditDigestSync(digestHex: string): string | null       // synchronous fallback (local-key)
 *  - verifySignature(signatureBase64: string, digestBuf: Buffer): Promise<boolean>
 *
 * Behavior:
 *  - If KMS configuration present (AUDIT_SIGNING_KMS_KEY_ID) uses KMS adapter to sign digest (digest-path).
 *  - If SIGNING_PROXY_URL is configured, will use signing proxy as alternative.
 *  - Falls back to local key / secret environment variables (AUDIT_SIGNING_KEY / AUDIT_SIGNING_SECRET / AUDIT_SIGNING_PRIVATE_KEY).
 *  - In production, callers should ensure signing is available (server startup enforces REQUIRE_KMS); when signing is absent signAuditDigest may return null.
 */

import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import * as kmsAdapter from './kmsAdapter';
import signingProxy from './signingProxyClient';

const DEFAULT_ALG = 'hmac-sha256';

/**
 * Canonicalize payload deterministically for audit digest.
 * Mirrors previous canonicalization implementation (sorted keys, JSON-escaped strings).
 */
export const canonicalizePayload = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizePayload(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizePayload(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

/**
 * Compute audit digest: SHA-256 over canonical payload bytes followed by prevHash bytes (if any).
 * Returns hex string lowercase.
 */
export const computeAuditDigest = (canonicalPayload: string, prevHashHex: string | null): string => {
  const canonicalBuffer = Buffer.from(canonicalPayload, 'utf8');
  const prevBuffer = prevHashHex ? Buffer.from(prevHashHex, 'hex') : Buffer.alloc(0);
  return crypto.createHash('sha256').update(Buffer.concat([canonicalBuffer, prevBuffer])).digest('hex');
};

/**
 * Async signing of a precomputed digest (hex string).
 * Preferred API for production (supports KMS / signing proxy / local keys).
 * Returns base64 signature string, or `null` if no signer is configured (caller must decide behavior).
 */
export async function signAuditDigest(digestHex: string): Promise<string | null> {
  if (!digestHex || typeof digestHex !== 'string') {
    throw new Error('digestHex (hex string) is required');
  }
  const digestBuf = Buffer.from(digestHex, 'hex');

  // 1) Prefer KMS adapter if configured
  const kmsKey = process.env.AUDIT_SIGNING_KMS_KEY_ID ?? process.env.AUDIT_SIGNING_KMS_KEY;
  if (kmsKey) {
    try {
      const resp = await kmsAdapter.signAuditHash(digestBuf);
      if (!resp || !resp.signature) throw new Error('KMS adapter returned no signature');
      return resp.signature;
    } catch (err) {
      // surface the error so callers can decide (we don't swallow by default)
      throw new Error(`KMS signing failed: ${(err as Error).message || String(err)}`);
    }
  }

  // 2) Signing proxy (optional)
  if (process.env.SIGNING_PROXY_URL) {
    try {
      const resp = await signingProxy.signAuditHash(digestBuf);
      if (!resp || !resp.signature) throw new Error('signing proxy returned no signature');
      return resp.signature;
    } catch (err) {
      throw new Error(`signing proxy failed: ${(err as Error).message || String(err)}`);
    }
  }

  // 3) Local key / secret fallback (synchronous)
  return signAuditDigestSync(digestHex);
}

/**
 * Synchronous signing fallback using local env keys.
 * Mirrors prior logic: look for AUDIT_SIGNING_KEY | AUDIT_SIGNING_SECRET | AUDIT_SIGNING_PRIVATE_KEY.
 * Returns base64 signature string or null if no local key available.
 *
 * NOTE: production should not rely on this; prefer KMS. In production an absent local key should be treated as error.
 */
export function signAuditDigestSync(digestHex: string): string | null {
  const signingKey = process.env.AUDIT_SIGNING_KEY ?? process.env.AUDIT_SIGNING_SECRET ?? process.env.AUDIT_SIGNING_PRIVATE_KEY ?? null;
  if (!signingKey) {
    return null;
  }

  const algorithm = (process.env.AUDIT_SIGNING_ALG ?? DEFAULT_ALG).toLowerCase();
  const digestBuffer = Buffer.from(digestHex, 'hex');

  if (algorithm === 'hmac-sha256' || algorithm === 'hmac') {
    return crypto.createHmac('sha256', signingKey).update(digestBuffer).digest('base64');
  }

  if (algorithm === 'ed25519') {
    // Ed25519: sign raw digest bytes
    try {
      // Node's crypto.sign for Ed25519 uses algorithm null and privateKey in PEM or KeyObject
      // If signingKey is a PEM private key, it should work; else attempt to sign buffer directly
      return crypto.sign(null as any, digestBuffer, signingKey as crypto.KeyLike).toString('base64');
    } catch (err) {
      // Try OpenSSL compatible fallback
      throw new Error(`ed25519 signing failed: ${(err as Error).message || String(err)}`);
    }
  }

  if (algorithm === 'rsa' || algorithm === 'rsa-sha256') {
    // RSA digest semantics: wrap with DigestInfo prefix (ASN.1) and use privateEncrypt as legacy approach,
    // or use crypto.sign with MessageType omitted (Node will hash). We prefer digest semantics:
    const DIGEST_PREFIX = Buffer.from('3031300d060960864801650304020105000420', 'hex'); // ASN.1 prefix for SHA-256
    const toSign = Buffer.concat([DIGEST_PREFIX, digestBuffer]);
    try {
      return crypto.privateEncrypt(
        {
          key: signingKey as crypto.KeyLike,
          padding: crypto.constants.RSA_PKCS1_PADDING
        },
        toSign
      ).toString('base64');
    } catch (err) {
      throw new Error(`rsa signing failed: ${(err as Error).message || String(err)}`);
    }
  }

  // Fallback deterministic HMAC so we always produce something when key exists.
  return crypto.createHmac('sha256', signingKey).update(digestBuffer).digest('base64');
}

/**
 * Verify signature over a precomputed digest buffer.
 * Prefers KMS verify when configured; falls back to local verification where possible.
 */
export async function verifySignature(signatureBase64: string, digestBuf: Buffer): Promise<boolean> {
  if (!Buffer.isBuffer(digestBuf)) throw new Error('digestBuf must be a Buffer');
  if (!signatureBase64) throw new Error('signatureBase64 is required');

  // Prefer KMS verify when configured
  const kmsKey = process.env.AUDIT_SIGNING_KMS_KEY_ID ?? process.env.AUDIT_SIGNING_KMS_KEY;
  if (kmsKey) {
    try {
      return await kmsAdapter.verifySignature(signatureBase64, digestBuf);
    } catch (err) {
      throw new Error(`KMS verify failed: ${(err as Error).message || String(err)}`);
    }
  }

  // Signing proxy verify
  if (process.env.SIGNING_PROXY_URL) {
    try {
      return await signingProxy.verifySignature(signatureBase64, digestBuf);
    } catch (err) {
      throw new Error(`signing proxy verify failed: ${(err as Error).message || String(err)}`);
    }
  }

  // Local verification fallback: assume HMAC or RSA/ED25519 based on AUDIT_SIGNING_ALG.
  const algorithm = (process.env.AUDIT_SIGNING_ALG ?? DEFAULT_ALG).toLowerCase();
  const sigBuf = Buffer.from(signatureBase64, 'base64');

  if (algorithm === 'hmac-sha256' || algorithm === 'hmac') {
    const signingKey = process.env.AUDIT_SIGNING_KEY ?? process.env.AUDIT_SIGNING_SECRET ?? null;
    if (!signingKey) throw new Error('local signing key not configured for HMAC verification');
    const expected = crypto.createHmac('sha256', signingKey).update(digestBuf).digest();
    return crypto.timingSafeEqual(expected, sigBuf);
  }

  if (algorithm === 'rsa' || algorithm === 'rsa-sha256') {
    const pubKey = process.env.AUDIT_SIGNING_PUBLIC_KEY ?? null;
    if (!pubKey) throw new Error('AUDIT_SIGNING_PUBLIC_KEY required for rsa verification');
    try {
      const ok = crypto.verify('sha256', digestBuf, pubKey as crypto.KeyLike, sigBuf);
      return Boolean(ok);
    } catch (err) {
      throw new Error(`rsa verify failed: ${(err as Error).message || String(err)}`);
    }
  }

  if (algorithm === 'ed25519') {
    const pubKey = process.env.AUDIT_SIGNING_PUBLIC_KEY ?? null;
    if (!pubKey) throw new Error('AUDIT_SIGNING_PUBLIC_KEY required for ed25519 verification');
    try {
      const ok = crypto.verify(null as any, digestBuf, pubKey as crypto.KeyLike, sigBuf);
      return Boolean(ok);
    } catch (err) {
      throw new Error(`ed25519 verify failed: ${(err as Error).message || String(err)}`);
    }
  }

  throw new Error(`Unsupported AUDIT_SIGNING_ALG for verify: ${algorithm}`);
}

export default {
  canonicalizePayload,
  computeAuditDigest,
  signAuditDigest,
  signAuditDigestSync,
  verifySignature
};

