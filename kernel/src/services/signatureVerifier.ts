import crypto from 'crypto';

const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export type SupportedAlgorithm = 'ed25519' | 'rsa-sha256';

export function normalizeSignatureAlgorithm(
  rawAlgorithm?: string,
  fallback: SupportedAlgorithm = 'ed25519',
): SupportedAlgorithm {
  if (!rawAlgorithm) return fallback;
  const normalized = String(rawAlgorithm).trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized.includes('ed25519')) return 'ed25519';
  if (normalized.includes('rsa')) return 'rsa-sha256';
  throw new Error(`Unsupported signature algorithm: ${rawAlgorithm}`);
}

function chunkBase64(input: string): string {
  return input.match(/.{1,64}/g)?.join('\n') || '';
}

function toPemFromDer(der: Buffer): string {
  const body = chunkBase64(der.toString('base64'));
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

export function normalizePublicKeyInput(publicKey: string): string {
  if (typeof publicKey !== 'string') {
    throw new Error('Public key must be a string');
  }
  const trimmed = publicKey.trim();
  if (!trimmed) {
    throw new Error('Public key is empty');
  }
  if (trimmed.startsWith('-----BEGIN')) {
    return trimmed;
  }
  const compact = trimmed.replace(/\s+/g, '');
  if (!BASE64_RE.test(compact)) {
    throw new Error('Public key must be PEM or base64');
  }
  let raw: Buffer;
  try {
    raw = Buffer.from(compact, 'base64');
  } catch (err) {
    throw new Error(`Public key is not valid base64: ${(err as Error).message}`);
  }
  if (!raw.length) {
    throw new Error('Decoded public key is empty');
  }
  if (raw.length === 32) {
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
    return toPemFromDer(spki);
  }
  return toPemFromDer(raw);
}

export function verifySignaturePayload(
  payload: string,
  signatureB64: string,
  algorithm: string,
  publicKey: string,
): void {
  if (!payload || typeof payload !== 'string') {
    throw new Error('Payload must be a non-empty string');
  }
  if (!signatureB64 || typeof signatureB64 !== 'string') {
    throw new Error('Signature must be a non-empty base64 string');
  }
  const sig = Buffer.from(signatureB64, 'base64');
  if (!sig.length) {
    throw new Error('Signature is empty after base64 decoding');
  }
  const normalizedAlg = normalizeSignatureAlgorithm(algorithm);
  const pem = normalizePublicKeyInput(publicKey);
  const keyObject = crypto.createPublicKey(pem);
  const payloadBuffer = Buffer.from(payload, 'utf8');

  let ok = false;
  if (normalizedAlg === 'ed25519') {
    ok = crypto.verify(null, payloadBuffer, keyObject, sig);
  } else if (normalizedAlg === 'rsa-sha256') {
    ok = crypto.verify('sha256', payloadBuffer, keyObject, sig);
  }

  if (!ok) {
    throw new Error(`Signature verification failed for algorithm ${normalizedAlg}`);
  }
}
