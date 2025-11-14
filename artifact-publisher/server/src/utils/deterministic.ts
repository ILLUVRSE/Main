import crypto from 'crypto';

export const deterministicHash = (input: string) =>
  crypto.createHash('sha256').update(input).digest('hex');

export const deterministicId = (input: string, prefix: string) =>
  `${prefix}_${deterministicHash(input).slice(0, 12)}`;

export const deterministicTimestamp = (seed: string) => {
  const hash = deterministicHash(seed);
  const epochMs = parseInt(hash.slice(0, 12), 16);
  return new Date(epochMs);
};

export const stableSort = <T>(items: T[], signature: (item: T) => string): T[] =>
  [...items].sort((a, b) => {
    const sigA = signature(a);
    const sigB = signature(b);
    return sigA.localeCompare(sigB);
  });
