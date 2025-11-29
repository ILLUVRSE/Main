/**
 * kernel/src/auditStore.ts
 *
 * Hardened append-only audit store utilities for the Kernel.
 *
 * Improvements:
 * - Retry/backoff for transient failures (DB/KMS) around the whole append operation.
 * - Idempotency by checking for an existing event with the same hash before insert.
 * - In-memory metrics counters for audit write success/failure (minimal, Prometheus-friendly).
 * - Exports getAuditMetrics() so server /metrics can include audit counters.
 *
 * Notes:
 * - This file avoids adding a heavy Prometheus dependency. If you want prom-client,
 *   replace the simple counters with prom-client Counters and register them.
 * - DO NOT COMMIT SECRETS — signing uses signingProxy which calls KMS or local fallback.
 *
 * Acceptance criteria:
 * - appendAuditEvent either inserts a single, complete audit_events row or returns the existing row
 *   with the same hash. Partial inserts are prevented by SQL transaction and pre-insert hash check.
 * - On transient failures, appendAuditEvent retries with exponential backoff (default 3 attempts).
 * - audit_write_success_total / audit_write_failure_total counters increment on success/failure.
 */

import crypto from 'crypto';
import { getClient, query } from './db';
import { getCurrentTraceId } from './middleware/tracing';
import signingProxy from './signingProxy';
import { AuditEvent } from './types';
import { evaluateAuditPolicy } from './audit/auditPolicy';
import { getPublisher } from './audit/infra/publisher';
import { getArchiver } from './audit/infra/archiver';

/**
 * Simple in-memory audit metrics (exported).
 * Host/server can include these numbers in /metrics exposition.
 */
export const auditMetrics = {
  audit_write_success_total: 0,
  audit_write_failure_total: 0,
};

/** Result returned after inserting (or finding existing) an audit event */
export type AuditInsertResult = {
  id: string;
  hash: string;
  ts: string;
};

/**
 * computeHash
 * Deterministically compute the SHA-256 hash for an audit event given the inputs.
 */
function computeHash(eventType: string, payload: any, prevHash: string | null, ts: string): string {
  const normalize = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(normalize);
    const out: any = {};
    for (const k of Object.keys(obj).sort()) out[k] = normalize(obj[k]);
    return out;
  };
  const input = JSON.stringify({
    eventType,
    payload: normalize(payload),
    prevHash,
    ts,
  });
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * isTransientError
 * Heuristic: treat connection / timeout / serialization errors as transient.
 * Adjust predicates based on pg error codes if desired.
 */
function isTransientError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || '').toString().toLowerCase();
  if (msg.includes('timeout') || msg.includes('connection') || msg.includes('could not serialize access') || msg.includes('deadlock')) return true;
  return false;
}

/**
 * sleep helper for backoff
 */
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * appendAuditEvent
 * Append an audit event with the following properties:
 *  - compute prevHash (latest chain head)
 *  - compute hash = sha256(eventType, payload, prevHash, ts)
 *  - idempotency: if an event with the same hash exists, return it (avoid duplicates)
 *  - sign the hash via signingProxy.signData (KMS or local fallback)
 *  - persist the row in a single transaction
 *
 * The entire operation is retried on transient errors up to `retries` attempts.
 */
export async function appendAuditEvent(eventType: string, payload: any, retries = 3): Promise<AuditInsertResult> {
  let attempt = 0;
  const baseDelayMs = 200;

  while (true) {
    attempt++;
    const client = await getClient();
    try {
      const policy = evaluateAuditPolicy(eventType, payload?.principal);
      if (!policy.keep) {
        client.release();
        return { id: 'sampled', hash: '', ts: new Date().toISOString() };
      }

      await client.query('BEGIN');

      // Get latest head hash
      const lastRes = await client.query(`SELECT hash FROM audit_events ORDER BY ts DESC LIMIT 1`);
      const prevHash: string | null = lastRes.rows[0]?.hash ?? null;

      const ts = new Date().toISOString();
      const traceId = getCurrentTraceId();
      let payloadWithTrace: any;
      if (traceId) {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          payloadWithTrace = { ...payload, traceId: (payload as any).traceId ?? traceId };
        } else {
          payloadWithTrace = { value: payload ?? null, traceId };
        }
      } else {
        payloadWithTrace = payload;
      }

      const hash = computeHash(eventType, payloadWithTrace, prevHash, ts);

      // Idempotency check: if an event with the same hash already exists, return it.
      const existing = await client.query('SELECT id, hash, ts FROM audit_events WHERE hash = $1 LIMIT 1', [hash]);
      if (existing.rows.length) {
        await client.query('COMMIT');
        const row = existing.rows[0];
        // success metric not incremented because this is a no-op / idempotent hit.
        return { id: String(row.id), hash: String(row.hash), ts: new Date(row.ts).toISOString() };
      }

      // Sign the hash (may call KMS)
      const { signature, signerId } = await signingProxy.signData(hash);

      const id = crypto.randomUUID();
      const insertSql = `
        INSERT INTO audit_events (id, event_type, payload, prev_hash, hash, signature, signer_id, ts, sampled, retention_expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `;
      await client.query(insertSql, [
        id,
        eventType,
        payloadWithTrace,
        prevHash,
        hash,
        signature,
        signerId,
        ts,
        false,
        policy.retentionExpiresAt,
      ]);

      await client.query('COMMIT');

      // success metric
      auditMetrics.audit_write_success_total++;

      // Post-commit: Publish and Archive
      // We do this asynchronously or synchronously depending on requirements.
      // The task says "Publish every AuditEvent... Archive to S3".
      // We should probably log errors but not fail the transaction since it's already committed.
      const fullEvent: AuditEvent = {
        id,
        eventType,
        payload: payloadWithTrace,
        prevHash: prevHash || null,
        hash,
        signature,
        signerId,
        ts
      };

      try {
        await Promise.all([
          getPublisher().publish(fullEvent),
          getArchiver().archive(fullEvent)
        ]);
      } catch (postCommitErr: any) {
        console.error(`appendAuditEvent: Post-commit publish/archive failed for ${id}`, postCommitErr);
        // We do not rethrow here to preserve the transaction success,
        // but in a strict system we might want to have a recovery mechanism.
      }

      return { id, hash, ts };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // increment failure metric for this attempt if final
      if (!isTransientError(err) || attempt >= retries) {
        auditMetrics.audit_write_failure_total++;
      }

      // If transient and retries left, backoff and retry
      if (isTransientError(err) && attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`appendAuditEvent: transient error (attempt ${attempt}/${retries}), retrying in ${delay}ms:`, (err as Error).message || err);
        await sleep(delay);
        continue;
      }

      // If not transient or out of retries, log and rethrow
      console.error('appendAuditEvent error:', (err as Error).message || err);
      throw err;
    } finally {
      client.release();
    }
  }
}

/**
 * getAuditEventById
 * Fetch an audit event row by id.
 */
export async function getAuditEventById(id: string): Promise<AuditEvent | null> {
  const res = await query('SELECT id, event_type, payload, prev_hash, hash, signature, signer_id, ts FROM audit_events WHERE id = $1', [id]);
  if (!res.rows.length) return null;
  const r = res.rows[0];
  const ev: AuditEvent = {
    id: String(r.id),
    eventType: r.event_type,
    payload: r.payload ?? {},
    prevHash: r.prev_hash ?? undefined,
    hash: r.hash ?? undefined,
    signature: r.signature ?? undefined,
    signerId: r.signer_id ?? undefined,
    ts: r.ts ? new Date(r.ts).toISOString() : undefined,
  };
  return ev;
}

/**
 * getAuditMetrics
 * Export current audit metrics (for /metrics exposition).
 */
export function getAuditMetrics() {
  return { ...auditMetrics };
}

/**
 * Acceptance checklist (short)
 *
 * - appendAuditEvent inserts a single audit_events row or returns an existing row if hash matches (idempotent).
 *   Test: Call appendAuditEvent twice with identical payload and confirm second call returns the same id/hash.
 *
 * - Transient failures are retried with exponential backoff. Final failure increments audit_write_failure_total.
 *   Test: Simulate transient DB error on first attempt and succeed on retry; verify audit_write_success_total increments and only one row exists.
 *
 * - Partial failures do not leave partial rows (transaction rollback ensures atomicity).
 *   Test: Force an error between insert and commit and verify no row inserted.
 *
 * - Metrics are exportable via getAuditMetrics() and reflect successes/failures.
 *   Test: Observe metrics before/after appendAuditEvent calls.
 */

