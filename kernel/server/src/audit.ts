import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { SigningBackend } from './signing';

export interface AuditEventRow {
  id: string;
  event_type: string;
  payload: unknown;
  prev_hash: string | null;
  hash: string;
  signature: string | null;
  signer_id: string | null;
  ts: Date;
}

export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const body = entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalize(v)).join(',');
    return '{' + body + '}';
  }
  return JSON.stringify(value);
}

export function sha256Hex(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function computeDigest(payload: unknown, prevHash?: string | null): string {
  const canonical = Buffer.from(canonicalize(payload), 'utf8');
  const prev = prevHash ? Buffer.from(prevHash, 'hex') : Buffer.alloc(0);
  return sha256Hex(Buffer.concat([canonical, prev]));
}

export async function appendAuditEvent(
  client: PoolClient,
  signer: SigningBackend,
  eventType: string,
  payload: unknown,
  now: Date = new Date()
): Promise<AuditEventRow> {
  const prevRes = await client.query<{ hash: string }>(
    'SELECT hash FROM audit_events ORDER BY ts DESC LIMIT 1 FOR UPDATE'
  );
  const prevHash = prevRes.rows[0]?.hash ?? null;
  const digest = computeDigest(payload, prevHash);
  const { signature, signerId } = await signer.signDigest(digest);
  if ((process.env.NODE_ENV || 'development') === 'production' && !signature) {
    throw new Error('Refusing to persist unsigned audit event in production');
  }
  const id = randomUUID();
  const insert = await client.query<AuditEventRow>(
    `INSERT INTO audit_events (id, event_type, payload, prev_hash, hash, signature, signer_id, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [id, eventType, payload, prevHash, digest, signature, signerId, now]
  );
  return insert.rows[0];
}
