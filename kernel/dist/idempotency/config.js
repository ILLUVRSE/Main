"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIdempotencyTableName = getIdempotencyTableName;
exports.getIdempotencyTtlSeconds = getIdempotencyTtlSeconds;
exports.computeIdempotencyExpiry = computeIdempotencyExpiry;
exports.getIdempotencyTtlIso = getIdempotencyTtlIso;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
function getIdempotencyTableName() {
    return process.env.IDEMPOTENCY_TABLE_NAME || 'idempotency';
}
function getIdempotencyTtlSeconds() {
    const raw = process.env.IDEMPOTENCY_TTL_SECONDS;
    if (!raw)
        return DEFAULT_TTL_SECONDS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_TTL_SECONDS;
    }
    return Math.floor(parsed);
}
function computeIdempotencyExpiry(baseDate = new Date()) {
    const ttlSeconds = getIdempotencyTtlSeconds();
    return new Date(baseDate.getTime() + ttlSeconds * 1000);
}
function getIdempotencyTtlIso(baseDate = new Date()) {
    return computeIdempotencyExpiry(baseDate).toISOString();
}
exports.default = {
    getIdempotencyTableName,
    getIdempotencyTtlSeconds,
    computeIdempotencyExpiry,
    getIdempotencyTtlIso,
};
