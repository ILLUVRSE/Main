import crypto from 'crypto';
export const deterministicHash = (input) => crypto.createHash('sha256').update(input).digest('hex');
export const deterministicId = (input, prefix) => `${prefix}_${deterministicHash(input).slice(0, 12)}`;
export const deterministicTimestamp = (seed) => {
    const hash = deterministicHash(seed);
    const epochMs = parseInt(hash.slice(0, 12), 16);
    return new Date(epochMs);
};
export const stableSort = (items, signature) => [...items].sort((a, b) => {
    const sigA = signature(a);
    const sigB = signature(b);
    return sigA.localeCompare(sigB);
});
