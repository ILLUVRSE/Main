"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runIdempotencyGcJob = runIdempotencyGcJob;
const db_1 = require("../db");
const config_1 = require("../idempotency/config");
function buildThresholdIso(now) {
    const ttlSeconds = (0, config_1.getIdempotencyTtlSeconds)();
    const thresholdMs = now.getTime() - ttlSeconds * 1000;
    return new Date(thresholdMs).toISOString();
}
async function runIdempotencyGcJob(now = new Date()) {
    const tableName = (0, config_1.getIdempotencyTableName)();
    const thresholdIso = buildThresholdIso(now);
    const sql = `DELETE FROM ${tableName}
    WHERE (expires_at IS NOT NULL AND expires_at <= NOW())
       OR (expires_at IS NULL AND created_at <= $1)`;
    const result = await (0, db_1.query)(sql, [thresholdIso]);
    return {
        deleted: result.rowCount ?? 0,
        thresholdIso,
    };
}
exports.default = runIdempotencyGcJob;
