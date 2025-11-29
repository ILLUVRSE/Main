/**
 * memory-layer/service/audit/auditChain.ts
 *
 * Canonicalization, digest computation, and audit signing utilities.
 * aligned with shared/lib/audit.ts for Kernel parity.
 *
 * Exports:
 *  - canonicalizePayload(value: unknown): string
 *  - computeAuditDigest(canonicalPayload: string, prevHashHex: string | null): string
 *  - signAuditDigest(digestHex: string): Promise<string | null>
 *  - signAuditDigestSync(digestHex: string): string | null
 *  - verifySignature(signatureBase64: string, digestBuf: Buffer): Promise<boolean>
 */

import crypto from 'node:crypto';
import { Buffer } from 'buffer';
// Lazy load kmsAdapter to avoid AWS SDK dependency in non-KMS envs (dev/test)
// import * as kmsAdapter from './kmsAdapter';
import signingProxy from './signingProxyClient';
import mockSigner from './mockSigner';

const DEFAULT_ALG = 'hmac-sha256';

/**
 * Sort value for canonicalization.
 * Matches shared/lib/audit.ts sortValue implementation.
 */
function sortValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([_, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortValue(v)]);
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * Canonicalize payload deterministically for audit digest.
 * Uses JSON.stringify(sortValue(payload)).
 */
export const canonicalizePayload = (value: unknown): string => {
  return JSON.stringify(sortValue(value));
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
 * Preferred API for production (supports KMS / signing proxy / mockSigner / local keys).
 * Returns base64 signature string, or `null` if no signer is configured.
 */
export async function signAuditDigest(digestHex: string): Promise<string | null> {
  if (!digestHex || typeof digestHex !== 'string') {
    throw new Error('digestHex (hex string) is required');
  }
  const digestBuf = Buffer.from(digestHex, 'hex');

  // 1) Prefer KMS adapter if configured
  const kmsConfigured = Boolean(process.env.AUDIT_SIGNING_KMS_KEY_ID || process.env.AUDIT_SIGNING_KMS_KEY);
  if (kmsConfigured) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const kmsAdapter = require('./kmsAdapter');
      const resp = await kmsAdapter.signAuditHash(digestBuf);
      if (!resp || !resp.signature) throw new Error('KMS adapter returned no signature');
      return resp.signature;
    } catch (err) {
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

  // 3) Mock signer for dev / CI
  const mockConfigured = Boolean(process.env.MOCK_AUDIT_SIGNING_KEY) || (process.env.NODE_ENV ?? '').toLowerCase() === 'development';
  if (mockConfigured) {
    try {
      const resp = await mockSigner.signAuditHash(digestBuf);
      if (!resp || !resp.signature) throw new Error('mock signer returned no signature');
      return resp.signature;
    } catch (err) {
      throw new Error(`mock signer failed: ${(err as Error).message || String(err)}`);
    }
  }

  // 4) Local key / secret fallback (synchronous)
  return signAuditDigestSync(digestHex);
}

/**
 * Synchronous signing fallback using local env keys.
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
    try {
      return crypto.sign(null as any, digestBuffer, signingKey as crypto.KeyLike).toString('base64');
    } catch (err) {
      throw new Error(`ed25519 signing failed: ${(err as Error).message || String(err)}`);
    }
  }

  if (algorithm === 'rsa' || algorithm === 'rsa-sha256') {
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

  return crypto.createHmac('sha256', signingKey).update(digestBuffer).digest('base64');
}

/**
 * Verify signature over a precomputed digest buffer.
 */
export async function verifySignature(signatureBase64: string, digestBuf: Buffer): Promise<boolean> {
  if (!Buffer.isBuffer(digestBuf)) throw new Error('digestBuf must be a Buffer');
  if (!signatureBase64) throw new Error('signatureBase64 is required');

  // 1) KMS verify when configured
  const kmsConfigured = Boolean(process.env.AUDIT_SIGNING_KMS_KEY_ID || process.env.AUDIT_SIGNING_KMS_KEY);
  if (kmsConfigured) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const kmsAdapter = require('./kmsAdapter');
      return await kmsAdapter.verifySignature(signatureBase64, digestBuf);
    } catch (err) {
      throw new Error(`KMS verify failed: ${(err as Error).message || String(err)}`);
    }
  }

  // 2) Signing proxy verify
  if (process.env.SIGNING_PROXY_URL) {
    try {
      return await signingProxy.verifySignature(signatureBase64, digestBuf);
    } catch (err) {
      throw new Error(`signing proxy verify failed: ${(err as Error).message || String(err)}`);
    }
  }

  // 3) Mock signer verify (dev/CI)
  const mockConfigured = Boolean(process.env.MOCK_AUDIT_SIGNING_KEY) || (process.env.NODE_ENV ?? '').toLowerCase() === 'development';
  if (mockConfigured) {
    try {
      return await mockSigner.verifySignature(signatureBase64, digestBuf);
    } catch (err) {
      throw new Error(`mock signer verify failed: ${(err as Error).message || String(err)}`);
    }
  }

  // 4) Local verification fallback
  const algorithm = (process.env.AUDIT_SIGNING_ALG ?? DEFAULT_ALG).toLowerCase();
  const sigBuf = Buffer.from(signatureBase64, 'base64');

  if (algorithm === 'hmac-sha256' || algorithm === 'hmac') {
    const signingKey = process.env.AUDIT_SIGNING_KEY ?? process.env.AUDIT_SIGNING_SECRET ?? null;
    if (!signingKey) throw new Error('local signing key not configured for HMAC verification');
    const expected = crypto.createHmac('sha256', signingKey).update(digestBuf).digest();
    if (expected.length !== sigBuf.length) return false;
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
