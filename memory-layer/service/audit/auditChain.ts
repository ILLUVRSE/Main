import crypto from 'node:crypto';

const DEFAULT_ALG = 'hmac-sha256';

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

export const computeAuditDigest = (canonicalPayload: string, prevHashHex: string | null): string => {
  const canonicalBuffer = Buffer.from(canonicalPayload, 'utf8');
  const prevBuffer = prevHashHex ? Buffer.from(prevHashHex, 'hex') : Buffer.alloc(0);
  return crypto.createHash('sha256').update(Buffer.concat([canonicalBuffer, prevBuffer])).digest('hex');
};

export const signAuditDigest = (digestHex: string): string | null => {
  const signingKey =
    process.env.AUDIT_SIGNING_KEY ?? process.env.AUDIT_SIGNING_SECRET ?? process.env.AUDIT_SIGNING_PRIVATE_KEY ?? null;
  if (!signingKey) {
    return null;
  }

  const algorithm = (process.env.AUDIT_SIGNING_ALG ?? DEFAULT_ALG).toLowerCase();
  const digestBuffer = Buffer.from(digestHex, 'hex');

  if (algorithm === 'hmac-sha256' || algorithm === 'hmac') {
    return crypto.createHmac('sha256', signingKey).update(digestBuffer).digest('base64');
  }

  if (algorithm === 'ed25519') {
    return crypto.sign(null, digestBuffer, signingKey).toString('base64');
  }

  if (algorithm === 'rsa' || algorithm === 'rsa-sha256') {
    const DIGEST_PREFIX = Buffer.from('3031300d060960864801650304020105000420', 'hex');
    const toSign = Buffer.concat([DIGEST_PREFIX, digestBuffer]);
    return crypto.privateEncrypt(
      {
        key: signingKey,
        padding: crypto.constants.RSA_PKCS1_PADDING
      },
      toSign
    ).toString('base64');
  }

  // Fallback to deterministic HMAC so we always produce a signature when a key exists.
  return crypto.createHmac('sha256', signingKey).update(digestBuffer).digest('base64');
};
