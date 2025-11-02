/**
 * kernel/src/auditStore.ts
 *
 * Append-only audit store utilities for the Kernel.
 * - appendAuditEvent(eventType, payload): computes prevHash/hash, signs hash, and persists to audit_events.
 * - getAuditEventById(id): fetch an audit event by id.
 *
 * NOTE: audit_events.id is a UUID column. Use crypto.randomUUID() (no custom prefix)
 * so inserted ids conform to UUID type expectations.
 *
 * Notes:
 * - Uses DB helpers from src/db and signingProxy for signatures.
 * - DO NOT COMMIT SECRETS — use Vault/KMS and environment variables for keys.
 */

import crypto from 'crypto';
import { getClient, query } from './db';
import signingProxy from './signingProxy';
import { AuditEvent } from './types';

/** Result returned after inserting an audit event */
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
 * appendAuditEvent
 * Create an append-only audit event:
 *  - Fetch latest prevHash (head of chain)
 *  - Compute hash = sha256(eventType,payload,prevHash,ts)
 *  - Sign the hash via signingProxy.signData
 *  - Persist into audit_events table
 *
 * Returns: { id, hash, ts }
 */
export async function appendAuditEvent(eventType: string, payload: any): Promise<AuditInsertResult> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Get latest head hash
    const lastRes = await client.query(`SELECT hash FROM audit_events ORDER BY ts DESC LIMIT 1`);
    const prevHash: string | null = lastRes.rows[0]?.hash ?? null;

    const ts = new Date().toISOString();
    const hash = computeHash(eventType, payload, prevHash, ts);

    // Sign the hash (KMS or local fallback)
    const { signature, signerId } = await signingProxy.signData(hash);

    // Use a plain UUID for the audit event id (Postgres column is UUID)
    const id = crypto.randomUUID();

    const insertSql = `
      INSERT INTO audit_events (id, event_type, payload, prev_hash, hash, signature, signer_id, ts)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `;
    await client.query(insertSql, [id, eventType, payload, prevHash, hash, signature, signerId, ts]);

    await client.query('COMMIT');
    return { id, hash, ts };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('appendAuditEvent error:', (err as Error).message || err);
    throw err;
  } finally {
    client.release();
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
 * Acceptance criteria (short, testable):
 *
 * - appendAuditEvent inserts a row into audit_events with a UUID id (no prefix), and fields:
 *   id, event_type, payload, prev_hash, hash, signature, signer_id, ts.
 *   Test: Call appendAuditEvent('test.event',{x:1}) and query audit_events for the returned id.
 *
 * - The stored hash equals computeHash(eventType,payload,prevHash,ts).
 *   Test: recompute and compare.
 *
 * - getAuditEventById returns a camelCase AuditEvent object or null when not found.
 *   Test: Insert an event, call getAuditEventById and verify fields.
 *
 * - Transactions: failures roll back and do not leave partial rows.
 *   Test: Simulate an error during insert and assert no row inserted.
 *
 * - Signatures use signingProxy.signData so KMS is used if configured; fallback to local ephemeral key for dev.
 */

