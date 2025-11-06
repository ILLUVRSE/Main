const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export function getIdempotencyTableName(): string {
  return process.env.IDEMPOTENCY_TABLE_NAME || 'idempotency';
}

export function getIdempotencyTtlSeconds(): number {
  const raw = process.env.IDEMPOTENCY_TTL_SECONDS;
  if (!raw) return DEFAULT_TTL_SECONDS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TTL_SECONDS;
  }
  return Math.floor(parsed);
}

export function computeIdempotencyExpiry(baseDate: Date = new Date()): Date {
  const ttlSeconds = getIdempotencyTtlSeconds();
  return new Date(baseDate.getTime() + ttlSeconds * 1000);
}

export function getIdempotencyTtlIso(baseDate: Date = new Date()): string {
  return computeIdempotencyExpiry(baseDate).toISOString();
}

export default {
  getIdempotencyTableName,
  getIdempotencyTtlSeconds,
  computeIdempotencyExpiry,
  getIdempotencyTtlIso,
};
