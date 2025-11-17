/* marketplace/server/lib/auditWriter.ts
 *
 * Append and query audit events with canonicalization, chained hashes, and optional signing.
 *
 * Notes:
 * - Requires postgres table `audit_events` (see migrations). If DB is not configured, keeps events in-memory.
 * - For signing:
 *   - If AUDIT_SIGNING_KMS_KEY_ID is present, will attempt AWS KMS Sign (MessageType: 'DIGEST').
 *   - Else if SIGNING_PROXY_URL + SIGNING_PROXY_API_KEY are present, will POST { digest_hex, algorithm } to /sign.
 *   - Otherwise events are stored unsigned (dev).
 */

import crypto from 'crypto';
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import { promisify } from 'util';
import { URL } from 'url';
import fetch from 'cross-fetch';

const gzip = promisify(zlib.gzip);

type AuditEventIn = {
  actor_id?: string;
  event_type: string;
  payload: any;
  created_at?: string;
};

type AuditRow = {
  id?: number;
  actor_id?: string;
  event_type?: string;
  payload?: any;
  hash?: string;
  prev_hash?: string | null;
  signature?: string | null;
  signer_kid?: string | null;
  created_at?: string;
};

let inMemoryStore: AuditRow[] = [];

/**
 * Try to load DB helper (server/lib/db). If not available, return null.
 */
function getDb(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dbMod = require('./db');
    return dbMod && (dbMod.default || dbMod);
  } catch {
    return null;
  }
}

/**
 * Canonicalize payload to a deterministic JSON string by sorting object keys recursively.
 */
function canonicalize(obj: any): string {
  return JSON.stringify(sortKeys(obj), (_k, v) => (v === undefined ? null : v));
}

function sortKeys(value: any): any {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const keys = Object.keys(value).sort();
  const out: any = {};
  for (const k of keys) {
    out[k] = sortKeys(value[k]);
  }
  return out;
}

/**
 * Compute chained hash: sha256(canonicalPayloadBytes || prevHashBytes)
 * prevHash is hex string or null.
 */
function computeChainedHash(canonicalPayload: string, prevHashHex?: string | null): string {
  const payloadBuf = Buffer.from(canonicalPayload, 'utf8');
  const prevBuf = prevHashHex ? Buffer.from(prevHashHex, 'hex') : Buffer.alloc(0);
  const combined = Buffer.concat([payloadBuf, prevBuf]);
  const h = crypto.createHash('sha256').update(combined).digest('hex');
  return h;
}

/**
 * Get last hash from DB or memory
 */
async function getLastHash(): Promise<string | null> {
  const db = getDb();
  if (db && typeof db.query === 'function') {
    try {
      const r = await db.query('SELECT hash FROM audit_events ORDER BY created_at DESC, id DESC LIMIT 1');
      if (r && r.rows && r.rows.length > 0) {
        return r.rows[0].hash || null;
      }
      return null;
    } catch (e) {
      // ignore
    }
  }
  // memory fallback
  const last = inMemoryStore.length ? inMemoryStore[inMemoryStore.length - 1] : null;
  return last ? last.hash || null : null;
}

/**
 * Signing helpers
 */
async function signDigestWithKms(digestHex: string): Promise<{ signatureB64: string; signer_kid?: string } | null> {
  const keyId = process.env.AUDIT_SIGNING_KMS_KEY_ID;
  if (!keyId) return null;

  try {
    // Lazy import AWS SDK to avoid hard dependency issues during tests
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { KMSClient, SignCommand } = require('@aws-sdk/client-kms');
    const client = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
    // Map our config string to KMS SigningAlgorithm
    const algEnv = (process.env.AUDIT_SIGNING_ALG || 'RSA_PKCS1_SHA_256').toUpperCase();
    const signingAlgorithm = algEnv.includes('PSS') ? 'RSASSA_PSS_SHA_256' : 'RSASSA_PKCS1_V1_5_SHA_256';
    const digestBuf = Buffer.from(digestHex, 'hex');

    const cmd = new SignCommand({
      KeyId: keyId,
      Message: digestBuf,
      SigningAlgorithm: signingAlgorithm,
      MessageType: 'DIGEST',
    });
    const resp = await client.send(cmd);
    if (resp && resp.Signature) {
      const sigB64 = Buffer.from(resp.Signature).toString('base64');
      // signer_kid: derive from keyId or environment
      const signerKid = process.env.AUDIT_SIGNING_SIGNER_KID || keyId;
      return { signatureB64: sigB64, signer_kid: signerKid };
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.debug('KMS sign failed:', (e as Error).message);
  }
  return null;
}

async function signDigestWithProxy(digestHex: string): Promise<{ signatureB64: string; signer_kid?: string } | null> {
  const proxyUrl = process.env.SIGNING_PROXY_URL;
  const apiKey = process.env.SIGNING_PROXY_API_KEY;
  if (!proxyUrl || !apiKey) return null;

  try {
    const u = new URL(proxyUrl);
    // Use a sign endpoint convention: POST { digest_hex, algorithm }
    const alg = process.env.AUDIT_SIGNING_ALG || 'RSA_PKCS1_SHA_256';
    const signEndpoint = `${u.href.replace(/\/$/, '')}/sign`;
    const resp = await fetch(signEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ digest_hex: digestHex, algorithm: alg }),
      // timeout: not available here directly; rely on default
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Signing proxy responded ${resp.status}: ${text}`);
    }
    const json = await resp.json().catch(() => null);
    // Expect { signature: '<base64>', signer_kid: '...' }
    if (json && (json.signature || json.signature_b64 || json.signatureB64)) {
      const signatureB64 = json.signature || json.signature_b64 || json.signatureB64;
      const signerKid = json.signer_kid || json.signerKid || json.signer;
      return { signatureB64, signer_kid: signerKid };
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.debug('signing proxy failed:', (e as Error).message);
  }
  return null;
}

/**
 * Append an audit event.
 * - event: { actor_id, event_type, payload, created_at? }
 * Returns the stored AuditRow (id + fields).
 */
export async function appendAuditEvent(event: AuditEventIn): Promise<AuditRow> {
  if (!event || !event.event_type || typeof event.payload === 'undefined') {
    throw new Error('Invalid audit event: event_type and payload are required');
  }

  const createdAt = event.created_at || new Date().toISOString();
  const actorId = event.actor_id || event.payload?.actor_id || 'unknown';
  const eventType = event.event_type;

  // Canonicalize payload
  const canonicalPayload = canonicalize(event.payload);
  // Get prev hash
  const prevHash = await getLastHash();
  const hash = computeChainedHash(canonicalPayload, prevHash || null);

  // Sign the digest (if possible)
  let signature: string | null = null;
  let signer_kid: string | null = null;

  // Attempt KMS first
  try {
    const kmsResult = await signDigestWithKms(hash);
    if (kmsResult && kmsResult.signatureB64) {
      signature = kmsResult.signatureB64;
      signer_kid = kmsResult.signer_kid || null;
    }
  } catch {
    // ignore
  }

  // If not signed by KMS, try signing proxy
  if (!signature) {
    try {
      const sp = await signDigestWithProxy(hash);
      if (sp && sp.signatureB64) {
        signature = sp.signatureB64;
        signer_kid = sp.signer_kid || null;
      }
    } catch {
      // ignore
    }
  }

  // Prepare row
  const row: AuditRow = {
    actor_id: actorId,
    event_type: eventType,
    payload: event.payload,
    hash,
    prev_hash: prevHash || null,
    signature: signature || null,
    signer_kid: signer_kid || null,
    created_at: createdAt,
  };

  // Persist to DB if available
  const db = getDb();
  if (db && typeof db.query === 'function') {
    try {
      const q = `INSERT INTO audit_events (actor_id, event_type, payload, hash, prev_hash, signature, signer_kid, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, actor_id, event_type, payload, hash, prev_hash, signature, signer_kid, created_at`;
      const params = [row.actor_id, row.event_type, row.payload, row.hash, row.prev_hash, row.signature, row.signer_kid, row.created_at];
      const res = await db.query(q, params);
      if (res && res.rows && res.rows[0]) {
        const stored = res.rows[0];
        return {
          id: stored.id,
          actor_id: stored.actor_id,
          event_type: stored.event_type,
          payload: stored.payload,
          hash: stored.hash,
          prev_hash: stored.prev_hash,
          signature: stored.signature,
          signer_kid: stored.signer_kid,
          created_at: stored.created_at,
        };
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.debug('Failed to persist audit event to DB, falling back to memory:', (e as Error).message);
    }
  }

  // Persist in-memory as fallback
  inMemoryStore.push(row);
  return row;
}

/**
 * Query audit events referencing an orderId (best-effort).
 * - If DB available, search payload->>'order_id' or payload text contains orderId
 * - Otherwise search in-memory store.
 */
export async function queryEvents(opts: { orderId?: string; limit?: number } = {}): Promise<AuditRow[]> {
  const { orderId, limit = 100 } = opts;
  const db = getDb();
  if (db && typeof db.query === 'function') {
    try {
      if (orderId) {
        const q = `SELECT actor_id, event_type, payload, hash, prev_hash, signature, signer_kid, created_at
          FROM audit_events
          WHERE (payload->>'order_id' = $1 OR payload->>'orderId' = $1 OR payload::text ILIKE $2)
          ORDER BY created_at DESC LIMIT $3`;
        const like = `%${orderId}%`;
        const r = await db.query(q, [orderId, like, limit]);
        return (r.rows || []).map((row: any) => ({
          actor_id: row.actor_id,
          event_type: row.event_type,
          payload: row.payload,
          hash: row.hash,
          prev_hash: row.prev_hash,
          signature: row.signature,
          signer_kid: row.signer_kid,
          created_at: row.created_at,
        }));
      } else {
        const q = `SELECT actor_id, event_type, payload, hash, prev_hash, signature, signer_kid, created_at
          FROM audit_events ORDER BY created_at DESC LIMIT $1`;
        const r = await db.query(q, [limit]);
        return (r.rows || []).map((row: any) => ({
          actor_id: row.actor_id,
          event_type: row.event_type,
          payload: row.payload,
          hash: row.hash,
          prev_hash: row.prev_hash,
          signature: row.signature,
          signer_kid: row.signer_kid,
          created_at: row.created_at,
        }));
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.debug('DB audit query failed, falling back to memory:', (e as Error).message);
    }
  }

  // Memory fallback
  if (orderId) {
    return inMemoryStore.filter((e) => JSON.stringify(e.payload || {}).includes(String(orderId))).slice(-limit).reverse();
  }
  return inMemoryStore.slice(-limit).reverse();
}

/**
 * Export audit batch to S3 or local path as gzipped JSONL.
 * - from/to are ISO timestamps (strings) or Date objects. If omitted, selects reasonable defaults (last 24h).
 * - If S3 env is configured, upload to S3_AUDIT_BUCKET with key prefix `marketplace/yyyy-mm-dd/<batch>.jsonl.gz`.
 */
export async function exportAuditBatch(opts: { from?: string | Date; to?: string | Date; outPath?: string; envTag?: string } = {}) {
  const from = opts.from ? new Date(opts.from) : new Date(Date.now() - 24 * 3600_000);
  const to = opts.to ? new Date(opts.to) : new Date();
  const envTag = opts.envTag || process.env.NODE_ENV || 'dev';
  const db = getDb();
  let rows: AuditRow[] = [];

  if (db && typeof db.query === 'function') {
    // Query DB for audit events in range
    const q = `SELECT actor_id, event_type, payload, hash, prev_hash, signature, signer_kid, created_at
      FROM audit_events
      WHERE created_at >= $1 AND created_at <= $2
      ORDER BY created_at ASC`;
    try {
      const r = await db.query(q, [from.toISOString(), to.toISOString()]);
      rows = (r.rows || []).map((row: any) => ({
        actor_id: row.actor_id,
        event_type: row.event_type,
        payload: row.payload,
        hash: row.hash,
        prev_hash: row.prev_hash,
        signature: row.signature,
        signer_kid: row.signer_kid,
        created_at: row.created_at,
      }));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.debug('exportAuditBatch DB query failed:', (e as Error).message);
      rows = [];
    }
  } else {
    // Memory fallback: filter in-memory store
    rows = inMemoryStore.filter((r) => {
      const t = r.created_at ? new Date(r.created_at) : new Date();
      return t >= from && t <= to;
    });
  }

  // Convert rows to newline JSONL
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const gzipBuf = await gzip(Buffer.from(jsonl, 'utf8'));

  // Try upload to S3 if configured
  const s3Endpoint = process.env.S3_ENDPOINT;
  const s3Bucket = process.env.S3_AUDIT_BUCKET || process.env.S3_BUCKET;
  if (s3Endpoint && s3Bucket) {
    try {
      // Lazy import AWS S3 client
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
      const s3Client = new S3Client({ region: process.env.S3_REGION || 'us-east-1', endpoint: s3Endpoint, forcePathStyle: true });
      const d = new Date();
      const keyPrefix = `marketplace/${d.toISOString().slice(0, 10)}`;
      const key = `${keyPrefix}/audit-${d.toISOString().replace(/[:.]/g, '-')}-${envTag}.jsonl.gz`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: key,
          Body: gzipBuf,
          ContentType: 'application/gzip',
          Metadata: {
            service: 'marketplace',
            env: envTag,
            version: process.env.npm_package_version || '0.0.0',
            pii_included: 'false',
            export_ts: new Date().toISOString(),
          },
        }),
      );
      return { success: true, location: `s3://${s3Bucket}/${key}` };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.debug('S3 upload failed, falling back to local file:', (e as Error).message);
    }
  }

  // Write to local file
  const outPath = opts.outPath || path.join('/tmp', `marketplace-audit-${Date.now()}.jsonl.gz`);
  await fs.promises.writeFile(outPath, gzipBuf);
  return { success: true, location: outPath };
}

export default {
  appendAuditEvent,
  queryEvents,
  exportAuditBatch,
};

