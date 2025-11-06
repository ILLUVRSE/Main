import { query } from '../db';
import { getIdempotencyTableName, getIdempotencyTtlSeconds } from '../idempotency/config';

export interface IdempotencyGcResult {
  deleted: number;
  thresholdIso: string;
}

function buildThresholdIso(now: Date): string {
  const ttlSeconds = getIdempotencyTtlSeconds();
  const thresholdMs = now.getTime() - ttlSeconds * 1000;
  return new Date(thresholdMs).toISOString();
}

export async function runIdempotencyGcJob(now: Date = new Date()): Promise<IdempotencyGcResult> {
  const tableName = getIdempotencyTableName();
  const thresholdIso = buildThresholdIso(now);

  const sql = `DELETE FROM ${tableName}
    WHERE (expires_at IS NOT NULL AND expires_at <= NOW())
       OR (expires_at IS NULL AND created_at <= $1)`;

  const result = await query(sql, [thresholdIso]);
  return {
    deleted: result.rowCount ?? 0,
    thresholdIso,
  };
}

export default runIdempotencyGcJob;
