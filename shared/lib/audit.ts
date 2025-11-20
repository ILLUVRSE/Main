/**
 * shared/lib/audit.ts
 *
 * Canonical audit helper utilities shared across services. Provides deterministic
 * canonicalization, SHA256 helpers, signature adapters (signing proxy + AWS KMS),
 * and an atomic audit_events append helper.
 */
import crypto from 'node:crypto';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';

type QueryableDb = Pool | PoolClient | {
  query: (text: string, params?: unknown[]) => Promise<QueryResult<any>>;
  connect?: () => Promise<PoolClient>;
};

export interface SignResult {
  signatureBase64: string;
  signer_kid: string;
  ts: string;
}

export interface SignHashOptions {
  signingProxyUrl?: string;
  signingProxyAuthToken?: string;
  kmsKeyId?: string;
  kmsEndpoint?: string;
  kmsRegion?: string;
}

export interface EmitAuditEventOptions {
  tableName?: string;
  orderColumn?: string;
  now?: Date;
  signing?: SignHashOptions;
}

const DEFAULT_TABLE = 'audit_events';
const DEFAULT_ORDER_COLUMN = 'created_at';

const BOOLEAN_TRUE = new Set(['true', '1', 'yes', 'y']);

const DEV_SIGNING_SECRET = process.env.DEV_SIGNING_SECRET || 'illuvrse-dev-signing-secret';

let kmsClient: KMSClient | null = null;

const identifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function canonicalize(payload: unknown): string {
  return JSON.stringify(sortValue(payload));
}

function sortValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([_, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortValue(v)]);
    return Object.fromEntries(entries);
  }
  return value;
}

export function sha256Hex(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function parseBool(value?: string): boolean {
  if (!value) return false;
  return BOOLEAN_TRUE.has(value.toLowerCase());
}

async function signViaProxy(hash: string, options: SignHashOptions): Promise<SignResult> {
  const url = options.signingProxyUrl || process.env.SIGNING_PROXY_URL;
  if (!url) {
    throw new Error('SIGNING_PROXY_URL not configured for signing proxy mode');
  }
  const fetchImpl = ensureFetch();
  const response = await fetchImpl(new URL('/sign', url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.signingProxyAuthToken
        ? { authorization: `Bearer ${options.signingProxyAuthToken}` }
        : {})
    },
    body: JSON.stringify({ hash })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Signing proxy error (${response.status}): ${text}`);
  }
  const json = await response.json();
  if (!json.signature || !json.signer_kid) {
    throw new Error('Signing proxy response missing signature or signer_kid');
  }
  return {
    signatureBase64: json.signature,
    signer_kid: json.signer_kid,
    ts: json.ts || new Date().toISOString()
  };
}

async function signViaKms(hash: string, options: SignHashOptions): Promise<SignResult> {
  const kmsKeyId = options.kmsKeyId || process.env.KMS_KEY_ID;
  if (!kmsKeyId) {
    throw new Error('KMS_KEY_ID must be set to sign via KMS');
  }
  const region = options.kmsRegion || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region && !options.kmsEndpoint) {
    throw new Error('AWS region or explicit kmsEndpoint required for KMS signing');
  }
  if (!kmsClient) {
    kmsClient = new KMSClient({
      region,
      endpoint: options.kmsEndpoint || process.env.KMS_ENDPOINT
    });
  }
  const hashBuffer = Buffer.from(hash, 'hex');
  const res = await kmsClient.send(new SignCommand({
    KeyId: kmsKeyId,
    Message: hashBuffer,
    MessageType: 'DIGEST',
    SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256'
  }));
  if (!res.Signature) {
    throw new Error('KMS SignCommand returned no signature');
  }
  return {
    signatureBase64: Buffer.from(res.Signature).toString('base64'),
    signer_kid: res.KeyId || kmsKeyId,
    ts: new Date().toISOString()
  };
}

export async function signHash(hash: string, options: SignHashOptions = {}): Promise<SignResult> {
  if (!hash || !/^[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error('signHash expects a 64 char hex digest');
  }

  const requireKms = parseBool(process.env.REQUIRE_KMS);
  const requireProxy = parseBool(process.env.REQUIRE_SIGNING_PROXY);
  const signingProxyUrl = options.signingProxyUrl || process.env.SIGNING_PROXY_URL;
  const kmsConfigured = Boolean(options.kmsKeyId || process.env.KMS_KEY_ID);

  if (signingProxyUrl) {
    return signViaProxy(hash, options);
  }
  if (kmsConfigured) {
    return signViaKms(hash, options);
  }
  if (process.env.NODE_ENV === 'production' || requireKms || requireProxy) {
    throw new Error('No signing backend configured but production guard requires one');
  }

  const signature = crypto
    .createHmac('sha256', DEV_SIGNING_SECRET)
    .update(hash)
    .digest('base64');
  return {
    signatureBase64: signature,
    signer_kid: 'dev-signer-v1',
    ts: new Date().toISOString()
  };
}

function ensureIdentifier(value: string, label: string): string {
  if (!identifierRegex.test(value)) {
    throw new Error(`${label} must be a valid SQL identifier (got "${value}")`);
  }
  return value;
}

function ensureFetch(): typeof fetch {
  if (typeof fetch === 'function') {
    return fetch;
  }
  throw new Error('Global fetch is not available. Use Node 18+ or polyfill fetch.');
}

async function withClient<T>(db: QueryableDb, fn: (client: PoolClient | QueryableDb) => Promise<T>): Promise<T> {
  if (typeof (db as Pool).connect === 'function') {
    const pool = db as Pool;
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }
  return fn(db);
}

export async function emitAuditEvent(
  db: QueryableDb,
  actor_id: string,
  event_type: string,
  payload: unknown,
  options: EmitAuditEventOptions = {}
): Promise<Record<string, unknown>> {
  if (!actor_id) {
    throw new Error('actor_id is required for audit events');
  }
  if (!event_type) {
    throw new Error('event_type is required for audit events');
  }
  const tableName = ensureIdentifier(options.tableName || DEFAULT_TABLE, 'tableName');
  const orderColumn = ensureIdentifier(options.orderColumn || DEFAULT_ORDER_COLUMN, 'orderColumn');
  const now = options.now || new Date();

  return withClient(db, async (client) => {
    await client.query('BEGIN');
    try {
      const prevRes = await client.query(
        `SELECT hash FROM ${tableName} WHERE actor_id = $1 ORDER BY ${orderColumn} DESC LIMIT 1 FOR UPDATE`,
        [actor_id]
      );
      const prev_hash = prevRes.rows[0]?.hash ?? null;
      const envelope = {
        actor_id,
        event_type,
        payload,
        prev_hash,
        created_at: now.toISOString()
      };
      const hash = sha256Hex(canonicalize(envelope));
      const { signatureBase64, signer_kid, ts } = await signHash(hash, options.signing);
      const id = crypto.randomUUID();
      const insertRes = await client.query(
        `INSERT INTO ${tableName} (id, actor_id, event_type, payload, prev_hash, hash, signature, signer_kid, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [id, actor_id, event_type, payload, prev_hash, hash, signatureBase64, signer_kid, now]
      );
      await client.query('COMMIT');
      return {
        ...insertRes.rows[0],
        hash,
        signature: signatureBase64,
        signer_kid,
        signature_ts: ts
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
