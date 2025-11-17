/**
 * marketplace/server/lib/auditWriter.ts
 *
 * Audit writer helpers for Marketplace:
 *  - appendAuditEvent(evt): append a single audit event to the audit table (or fallback file)
 *  - exportAuditBatch(opts): export a date range of audit rows as newline-delimited JSONL.gz to S3 (Object Lock bucket)
 *
 * Behavior:
 *  - If DATABASE_URL is present, appendAuditEvent will insert into `audit_events` table.
 *    If not present, it will write to local file `./audit-logs/<env>-local.log` (one JSON per line).
 *  - When inserting to DB we compute a hash for the event (sha256 of canonical JSON) and chain it to the previous event's hash (prev_hash).
 *  - Optionally sign event hash (signature) using either:
 *     - SIGNING_PROXY_URL (preferred) OR
 *     - AUDIT_SIGNING_KMS_KEY_ID (AWS KMS). If KMS/Signing proxy are not configured we leave signature null.
 *  - exportAuditBatch queries DB for events in the range and writes a gzipped JSONL to S3_AUDIT_BUCKET (requires AWS creds).
 *
 * Notes:
 *  - This implementation is pragmatic and intended for dev/staging and to be extended for production hardening.
 *  - Ensure you have `pg` installed for DB access and `@aws-sdk/client-s3` + `@aws-sdk/client-kms` if you use S3/KMS signing.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import fetch from 'node-fetch';

const gzip = promisify(zlib.gzip);

// Try to import pg and AWS SDK lazily so code doesn't crash if deps aren't installed
let pg: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  pg = require('pg');
} catch {
  pg = null;
}

let S3Client: any = null;
let PutObjectCommand: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const aws = require('@aws-sdk/client-s3');
  S3Client = aws.S3Client;
  PutObjectCommand = aws.PutObjectCommand;
} catch {
  S3Client = null;
}

let KMSClient: any = null;
let SignCommand: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const kms = require('@aws-sdk/client-kms');
  KMSClient = kms.KMSClient;
  SignCommand = kms.SignCommand;
} catch {
  KMSClient = null;
}

// Configuration via env
const DATABASE_URL = process.env.DATABASE_URL || '';
const S3_AUDIT_BUCKET = process.env.S3_AUDIT_BUCKET || '';
const S3_AUDIT_PREFIX = process.env.S3_AUDIT_PREFIX || 'reasoning-graph|marketplace';
const AUDIT_LOCAL_DIR = process.env.AUDIT_LOCAL_DIR || path.join(process.cwd(), 'audit-logs');
const SIGNING_PROXY_URL = process.env.SIGNING_PROXY_URL || '';
const SIGNING_PROXY_API_KEY = process.env.SIGNING_PROXY_API_KEY || '';
const AUDIT_SIGNING_KMS_KEY_ID = process.env.AUDIT_SIGNING_KMS_KEY_ID || '';
const AUDIT_SIGNING_ALG = process.env.AUDIT_SIGNING_ALG || 'SHA256'; // for KMS Sign
const ENV_TAG = process.env.APP_ENV || process.env.NODE_ENV || 'dev';

let pgPool: any = null;
if (pg && DATABASE_URL) {
  pgPool = new pg.Pool({ connectionString: DATABASE_URL });
}

/* -------------------------
 * Helpers
 * ------------------------- */

function canonicalize(obj: any): string {
  // Deterministically stringify an object (sorted keys).
  // For nested objects, sort keys recursively.
  const seen = new WeakSet();

  function sorter(value: any): any {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return value; // prevent cycles
    seen.add(value);
    if (Array.isArray(value)) {
      return value.map(sorter);
    }
    const out: any = {};
    Object.keys(value)
      .sort()
      .forEach((k) => {
        out[k] = sorter(value[k]);
      });
    return out;
  }

  return JSON.stringify(sorter(obj));
}

function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/* -------------------------
 * Signing helpers
 * ------------------------- */

async function signWithSigningProxy(hashHex: string): Promise<{ signature: string; signer_kid?: string } | null> {
  if (!SIGNING_PROXY_URL) return null;
  try {
    const res = await fetch(`${SIGNING_PROXY_URL.replace(/\/$/, '')}/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SIGNING_PROXY_API_KEY ? { Authorization: `Bearer ${SIGNING_PROXY_API_KEY}` } : {}),
      },
      body: JSON.stringify({ hash: hashHex }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Signing proxy error ${res.status}: ${txt}`);
    }
    const json = await res.json();
    // Expected { signature: base64, signer_kid: '...' }
    if (json && json.signature) return { signature: json.signature, signer_kid: json.signer_kid || undefined };
    return null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('signWithSigningProxy error:', err && err.message ? err.message : err);
    return null;
  }
}

async function signWithKms(hashHex: string): Promise<{ signature: string; signer_kid?: string } | null> {
  if (!AUDIT_SIGNING_KMS_KEY_ID) return null;
  if (!KMSClient || !SignCommand) {
    // eslint-disable-next-line no-console
    console.warn('KMS signing requested but AWS KMS client not available');
    return null;
  }
  try {
    const kms = new KMSClient({});
    // AWS KMS Sign expects a binary digest; our backend earlier uses MessageType: 'DIGEST' for precomputed digests.
    const digest = Buffer.from(hashHex, 'hex');
    const cmd = new SignCommand({
      KeyId: AUDIT_SIGNING_KMS_KEY_ID,
      Message: digest,
      MessageType: 'DIGEST',
      // SigningAlgorithm depends on key type; we accept default (caller should set AUDIT_SIGNING_ALG if needed)
    });
    const resp = await kms.send(cmd);
    const sig = resp?.Signature ? Buffer.from(resp.Signature).toString('base64') : null;
    if (sig) return { signature: sig, signer_kid: AUDIT_SIGNING_KMS_KEY_ID };
    return null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('signWithKms error:', err && err.message ? err.message : err);
    return null;
  }
}

/* -------------------------
 * appendAuditEvent
 * ------------------------- */

export type AuditEventIn = {
  actor_id?: string;
  event_type: string;
  payload: any;
  created_at?: string; // optional ISO timestamp
};

export async function appendAuditEvent(evt: AuditEventIn): Promise<{ ok: true; id?: number } | never> {
  if (!evt || typeof evt.event_type !== 'string') {
    throw new Error('event_type required for audit event');
  }

  const created_at = evt.created_at || new Date().toISOString();

  // Canonical payload and compute hash
  const canonicalPayload = {
    actor_id: evt.actor_id || null,
    event_type: evt.event_type,
    payload: evt.payload ?? null,
    created_at,
  };
  const canonical = canonicalize(canonicalPayload);
  const hash = sha256Hex(canonical);

  // Determine prev_hash: if DB available, fetch last row
  let prev_hash: string | null = null;
  if (pgPool) {
    try {
      const client = await pgPool.connect();
      try {
        const q = 'SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1';
        const r = await client.query(q);
        if (r && r.rows && r.rows.length > 0) prev_hash = r.rows[0].hash || null;
      } finally {
        client.release();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug('appendAuditEvent: unable to fetch prev_hash', err && err.message ? err.message : err);
      prev_hash = null;
    }
  } else {
    // Fallback: try to read last line from local file
    try {
      const file = path.join(AUDIT_LOCAL_DIR, `${ENV_TAG}-local.log`);
      if (fs.existsSync(file)) {
        const data = fs.readFileSync(file, 'utf8');
        const lines = data.trim().split('\n').filter(Boolean);
        if (lines.length > 0) {
          const last = JSON.parse(lines[lines.length - 1]);
          prev_hash = last.hash || null;
        }
      }
    } catch {
      // ignore
    }
  }

  // Signature: try signing proxy -> KMS -> null
  let signature: string | null = null;
  let signer_kid: string | null = null;

  try {
    const proxyRes = await signWithSigningProxy(hash);
    if (proxyRes && proxyRes.signature) {
      signature = proxyRes.signature;
      signer_kid = proxyRes.signer_kid || null;
    } else {
      const kmsRes = await signWithKms(hash);
      if (kmsRes && kmsRes.signature) {
        signature = kmsRes.signature;
        signer_kid = kmsRes.signer_kid || null;
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.debug('appendAuditEvent: signing failed', err && err.message ? err.message : err);
    signature = null;
  }

  // Build row
  const row = {
    actor_id: evt.actor_id || null,
    event_type: evt.event_type,
    payload: canonicalPayload.payload,
    created_at,
    hash,
    prev_hash,
    signature,
    signer_kid,
  };

  // Persist
  if (pgPool) {
    try {
      const client = await pgPool.connect();
      try {
        const insertSql = `
          INSERT INTO audit_events
            (actor_id, event_type, payload, created_at, hash, prev_hash, signature, signer_kid)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING id
        `;
        const params = [row.actor_id, row.event_type, row.payload, row.created_at, row.hash, row.prev_hash, row.signature, row.signer_kid];
        const res = await client.query(insertSql, params);
        const id = (res && res.rows && res.rows[0] && res.rows[0].id) || undefined;
        return { ok: true, id };
      } finally {
        client.release();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('appendAuditEvent: DB insert failed:', err && err.message ? err.message : err);
      // Fall through to local file fallback
    }
  }

  // Local file fallback
  try {
    if (!fs.existsSync(AUDIT_LOCAL_DIR)) fs.mkdirSync(AUDIT_LOCAL_DIR, { recursive: true });
    const file = path.join(AUDIT_LOCAL_DIR, `${ENV_TAG}-local.log`);
    const out = { ...row };
    // Write each audit row as JSONL
    fs.appendFileSync(file, JSON.stringify(out) + '\n', { encoding: 'utf8' });
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('appendAuditEvent: local file write failed', err && err.message ? err.message : err);
    throw new Error('Failed to persist audit event');
  }
}

/* -------------------------
 * exportAuditBatch
 * ------------------------- */

export type ExportOpts = {
  fromIso: string; // inclusive
  toIso: string; // inclusive
  envTag?: string;
  outPath?: string; // optional key path for S3; if absent, we'll generate one
};

export async function exportAuditBatch(opts: ExportOpts): Promise<{ ok: true; location?: string } | never> {
  const from = new Date(opts.fromIso);
  const to = new Date(opts.toIso);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('Invalid from/to timestamps');
  }

  if (!pgPool) {
    throw new Error('exportAuditBatch requires a DATABASE_URL to query audit rows');
  }

  // Query rows
  try {
    const client = await pgPool.connect();
    try {
      const q = `
        SELECT id, actor_id, event_type, payload, created_at, hash, prev_hash, signature, signer_kid
        FROM audit_events
        WHERE created_at >= $1 AND created_at <= $2
        ORDER BY id ASC
      `;
      const res = await client.query(q, [from.toISOString(), to.toISOString()]);
      const rows = (res && res.rows) || [];

      // Convert to newline-delimited JSON canonicalized objects (include metadata)
      const jsonLines = rows.map((r: any) => {
        const event = {
          id: r.id,
          actor_id: r.actor_id,
          event_type: r.event_type,
          payload: r.payload,
          created_at: r.created_at,
          hash: r.hash,
          prev_hash: r.prev_hash,
          signature: r.signature,
          signer_kid: r.signer_kid,
        };
        return JSON.stringify(event);
      });

      const buffer = Buffer.from(jsonLines.join('\n'), 'utf8');
      const gz = await gzip(buffer);

      // Upload to S3 if configured
      if (!S3_AUDIT_BUCKET) {
        // Write local file fallback
        const outDir = path.join(AUDIT_LOCAL_DIR, 'exports');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const filename = opts.outPath || `${S3_AUDIT_PREFIX}/${ENV_TAG}/${from.toISOString().slice(0,10)}-${to.toISOString().slice(0,10)}.jsonl.gz`;
        const filepath = path.join(outDir, path.basename(filename));
        fs.writeFileSync(filepath, gz);
        return { ok: true, location: `file://${filepath}` };
      }

      if (!S3Client || !PutObjectCommand) {
        throw new Error('AWS S3 SDK not available');
      }

      const s3 = new S3Client({});
      const key = opts.outPath || `${S3_AUDIT_PREFIX}/${ENV_TAG}/${from.toISOString().slice(0,10)}/${Date.now()}-audit.jsonl.gz`;
      const putCmd = new PutObjectCommand({
        Bucket: S3_AUDIT_BUCKET,
        Key: key,
        Body: gz,
        ContentType: 'application/gzip',
      });

      await s3.send(putCmd);

      const location = `s3://${S3_AUDIT_BUCKET}/${key}`;
      return { ok: true, location };
    } finally {
      client.release();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('exportAuditBatch failed', err && err.message ? err.message : err);
    throw err;
  }
}

/* -------------------------
 * Utility: audit-verify helper (very small)
 * ------------------------- */

/**
 * verifyAuditChain(rows)
 * - Verifies the chaining of hashes and (optionally) signatures presence.
 * - Returns true if chain ok.
 */
export function verifyAuditChain(rows: Array<any>): { ok: boolean; error?: string; details?: any } {
  try {
    let prev: string | null = null;
    for (const r of rows) {
      const canonical = canonicalize({
        actor_id: r.actor_id ?? null,
        event_type: r.event_type,
        payload: r.payload ?? null,
        created_at: r.created_at,
      });
      const hash = sha256Hex(canonical);
      if (String(hash) !== String(r.hash)) {
        return { ok: false, error: 'hash_mismatch', details: { id: r.id, expected: hash, got: r.hash } };
      }
      if ((r.prev_hash || null) !== (prev || null)) {
        return { ok: false, error: 'prev_hash_mismatch', details: { id: r.id, prev_hash: r.prev_hash, expected_prev: prev } };
      }
      // signature presence check (if signer_kid present)
      if (r.signer_kid && !r.signature) {
        return { ok: false, error: 'signature_missing', details: { id: r.id } };
      }
      prev = r.hash;
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: 'verify_failed', details: String(err?.message || err) };
  }
}

/* -------------------------
 * Exports
 * ------------------------- */

export default {
  appendAuditEvent,
  exportAuditBatch,
  verifyAuditChain,
};

