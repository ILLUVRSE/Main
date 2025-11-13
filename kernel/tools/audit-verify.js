#!/usr/bin/env node
// kernel/tools/audit-verify.js
// Verifies audit_events chain integrity + signatures using canonical JSON hashing rules.
// Exports helpers so Jest/unit tests can import parseSignerRegistry, canonicalize, etc.
//
// CLI:
//   node kernel/tools/audit-verify.js \
//     --database-url "$POSTGRES_URL" \
//     --signers kernel/tools/signers.json \
//     --limit 200 \
//     --since "2024-11-01"
//
// Exit code: 0 if verification succeeded (or no signed events), >0 otherwise.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const agentManagerSigner = require('../../agent-manager/server/audit_signer');

const DEFAULT_SIGNERS_PATH = path.resolve(__dirname, 'signers.json');
const DEFAULT_DB_URL =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/illuvrse';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;
const HEX_RE = /^[0-9a-fA-F]+$/;

function log(...args) {
  console.log('[audit-verify]', ...args);
}

function err(...args) {
  console.error('[audit-verify]', ...args);
}

/* -------------------------------------------------------------------------- */
/*                                 Canonicalize                               */
/* -------------------------------------------------------------------------- */

const agentCanonicalize = agentManagerSigner && agentManagerSigner.canonicalize
  ? agentManagerSigner.canonicalize
  : null;

if (typeof agentCanonicalize !== 'function') {
  throw new Error('agent-manager canonicalize helper not found');
}

function normalizeCanonicalInput(value) {
  if (value === undefined) return null;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return value;
}

/**
 * Canonicalize helper that wraps the agent-manager implementation and returns a Buffer.
 */
function canonicalize(value) {
  const normalized = normalizeCanonicalInput(value);
  const str = agentCanonicalize(normalized);
  if (typeof str !== 'string') {
    throw new Error('canonicalize must return a string');
  }
  return Buffer.from(str, 'utf8');
}

/* -------------------------------------------------------------------------- */
/*                            Signer registry parser                          */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {{ publicKey: string, algorithm?: 'rsa-sha256' | 'ed25519' }} SignerInfo
 */

function normalizeAlgorithm(raw, signerId) {
  if (!raw && raw !== 0) return undefined;
  const norm = String(raw).trim().toLowerCase();
  if (!norm) return undefined;
  if (norm.includes('ed25519')) return 'ed25519';
  if (norm.includes('hmac')) return 'hmac-sha256';
  if (norm === 'rsa' || norm === 'rsa-sha256' || norm === 'rsa_sha256' || norm.includes('rsa')) return 'rsa-sha256';
  throw new Error(`Unsupported algorithm "${raw}" for signer ${signerId}`);
}

function chunkBase64(str) {
  return str.match(/.{1,64}/g)?.join('\n') || '';
}

function derToPem(buf) {
  const body = chunkBase64(buf.toString('base64'));
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

function normalizePublicKey(signerId, key) {
  if (typeof key !== 'string') {
    throw new Error(`Public key for ${signerId} must be a string`);
  }
  const trimmed = key.trim();
  if (!trimmed) {
    throw new Error(`Public key for ${signerId} is empty`);
  }
  if (trimmed.startsWith('-----BEGIN')) {
    return trimmed;
  }
  const compact = trimmed.replace(/\s+/g, '');
  if (!BASE64_RE.test(compact)) {
    throw new Error(`Public key for ${signerId} must be PEM or base64 DER/Ed25519`);
  }
  let buf;
  try {
    buf = Buffer.from(compact, 'base64');
  } catch (e) {
    throw new Error(`Public key for ${signerId} is not valid base64`);
  }
  if (!buf.length) {
    throw new Error(`Public key for ${signerId} decoded to 0 bytes`);
  }
  if (buf.length === 32) {
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, buf]);
    return derToPem(spki);
  }
  if (buf.length < 32) {
    throw new Error(`Public key for ${signerId} is too short (${buf.length} bytes)`);
  }
  return derToPem(buf);
}

/**
 * parseSignerRegistry
 * Accepts:
 *   - Array of signer objects
 *   - { signers: [...] }
 *   - object/map of signerId -> { publicKey, algorithm }
 * Returns Map<string, SignerInfo>.
 */
function parseSignerRegistry(registryInput) {
  if (!registryInput || (typeof registryInput !== 'object' && !Array.isArray(registryInput))) {
    throw new Error('Signer registry must be an array or object');
  }

  let entries = [];
  if (Array.isArray(registryInput)) {
    entries = registryInput;
  } else if (registryInput instanceof Map) {
    entries = Array.from(registryInput.entries()).map(([signerId, val]) => {
      if (typeof val === 'string') return { signerId, publicKey: val };
      return { signerId, ...(val || {}) };
    });
  } else if (Array.isArray(registryInput.signers)) {
    entries = registryInput.signers;
  } else {
    entries = Object.keys(registryInput).map((signerId) => {
      const val = registryInput[signerId];
      if (typeof val === 'string') {
        return { signerId, publicKey: val };
      }
      return { signerId, ...(val || {}) };
    });
  }

  if (!entries.length) {
    throw new Error('Signer registry contains no entries');
  }

  const map = new Map();
  entries.forEach((entry, idx) => {
    if (!entry) return;
    let signerId = entry.signerId || entry.signer_id || entry.id || entry.kid;
    if (!signerId && typeof idx === 'number') {
      throw new Error(`Signer entry at index ${idx} is missing signerId`);
    }
    signerId = String(signerId);

    let publicKey =
      entry.publicKey ||
      entry.public_key ||
      entry.publicKeyPem ||
      entry.public_key_pem ||
      entry.key ||
      entry.pub ||
      entry.pem ||
      entry.value ||
      null;
    if (!publicKey) {
      throw new Error(`Signer ${signerId} is missing a publicKey`);
    }
    publicKey = normalizePublicKey(signerId, publicKey);

    const algorithm = normalizeAlgorithm(entry.algorithm || entry.alg, signerId);
    map.set(signerId, { publicKey, algorithm });
  });

  if (!map.size) {
    throw new Error('Signer registry parsing produced no signers');
  }

  return map;
}

/* -------------------------------------------------------------------------- */
/*                           Public key construction                          */
/* -------------------------------------------------------------------------- */

function createKeyObject(publicKeyStr) {
  if (!publicKeyStr) {
    throw new Error('publicKey string is required');
  }
  const trimmed = String(publicKeyStr).trim();
  if (trimmed.startsWith('-----BEGIN')) {
    return crypto.createPublicKey(trimmed);
  }

  const compact = trimmed.replace(/\s+/g, '');
  let buf;
  try {
    buf = Buffer.from(compact, 'base64');
  } catch (e) {
    throw new Error('Public key parse error: invalid base64');
  }
  if (!buf.length) {
    throw new Error('Public key parse error: decoded length 0');
  }
  if (buf.length === 32) {
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, buf]);
    return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
  }
  try {
    return crypto.createPublicKey({ key: buf, format: 'der', type: 'spki' });
  } catch (e) {
    throw new Error(`Public key parse error: ${e.message || e}`);
  }
}

/* -------------------------------------------------------------------------- */
/*                               Verification                                */
/* -------------------------------------------------------------------------- */

function detectSigFormat(sigStr) {
  if (!sigStr) return 'base64';
  if (HEX_RE.test(sigStr)) return 'hex';
  return 'base64';
}

function decodeSignature(sigStr) {
  if (sigStr == null) return null;
  const fmt = detectSigFormat(sigStr);
  try {
    return Buffer.from(sigStr, fmt);
  } catch (e) {
    throw new Error('Invalid signature encoding');
  }
}

function toDigestBuffer(value, label = 'digest') {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') {
    const hex = value.trim();
    if (!hex) throw new Error(`${label} is empty`);
    if (!HEX_RE.test(hex) || hex.length % 2 !== 0) {
      throw new Error(`${label} must be an even-length hex string`);
    }
    return Buffer.from(hex, 'hex');
  }
  if (Array.isArray(value)) {
    return Buffer.from(value);
  }
  if (value && typeof value === 'object') {
    if (value.type === 'Buffer' && Array.isArray(value.data)) {
      return Buffer.from(value.data);
    }
  }
  throw new Error(`${label} must be a Buffer or hex string`);
}

function hexToBuffer(hex, label) {
  if (!hex) return Buffer.alloc(0);
  if (!HEX_RE.test(hex) || hex.length % 2 !== 0) {
    throw new Error(`${label || 'hex value'} is not valid hex`);
  }
  return Buffer.from(hex, 'hex');
}

function computeHashParts(payload, prevHash) {
  const canonical = canonicalize(payload ?? null);
  const prevBytes = prevHash ? hexToBuffer(prevHash, 'prev_hash') : Buffer.alloc(0);
  const concat = Buffer.concat([canonical, prevBytes]);
  const hashBytes = crypto.createHash('sha256').update(concat).digest();
  return {
    canonical,
    concat,
    hashBytes,
    hashHex: hashBytes.toString('hex')
  };
}

function verifyEvents(events, signerMap) {
  if (!Array.isArray(events)) throw new Error('events must be an array');
  if (!signerMap || typeof signerMap.get !== 'function') throw new Error('signerMap must be a Map');

  const keyCache = new Map();
  let expectedPrevHash = '';
  let headHash = '';

  for (const row of events) {
    const id = row && (row.id || row.ID || row.uuid) ? String(row.id || row.ID || row.uuid) : 'unknown';
    const signerId = String(row.signer_kid || row.signer_id || row.signerId || '');
    if (!signerId) throw new Error(`Missing signerId for event ${id}`);
    const signer = signerMap.get(signerId);
    if (!signer) throw new Error(`Unknown signer ${signerId} for event ${id}`);

    let signature = row.signature;
    if (Buffer.isBuffer(signature)) {
      signature = signature.toString('base64');
    }
    if (!signature) throw new Error(`Missing signature for event ${id}`);

    const storedPrev = row.prev_hash || row.prevHash || '';
    const storedHash = row.hash || row.Hash || '';

    const { concat, hashBytes, hashHex } = computeHashParts(row.payload, storedPrev);

    if (expectedPrevHash && storedPrev !== expectedPrevHash) {
      throw new Error(`prevHash mismatch for event ${id}: expected ${expectedPrevHash} got ${storedPrev}`);
    }
    if (storedHash && storedHash !== hashHex) {
      throw new Error(`Hash mismatch for event ${id}: stored ${storedHash} computed ${hashHex}`);
    }

    let keyObj = keyCache.get(signerId);
    if (!keyObj) {
      keyObj = createKeyObject(signer.publicKey);
      keyCache.set(signerId, keyObj);
    }

    const sigBuf = decodeSignature(signature);
    if (!sigBuf) throw new Error(`Signature decode failed for event ${id}`);

    let algorithm = signer.algorithm;
    if (!algorithm && keyObj.asymmetricKeyType) {
      const type = keyObj.asymmetricKeyType.toLowerCase();
      if (type === 'ed25519') algorithm = 'ed25519';
      else if (type === 'rsa') algorithm = 'rsa-sha256';
    }

    const digestSource =
      row.hash_bytes ??
      row.hashBytes ??
      row.hash_buffer ??
      row.digest ??
      row.digest_hex ??
      row.digestHex ??
      hashBytes;
    const digestBuffer = toDigestBuffer(digestSource, `hash bytes for event ${id}`);

    if (algorithm === 'ed25519') {
      const ok = crypto.verify(null, digestBuffer, keyObj, sigBuf);
      if (!ok) throw new Error(`Signature verification failed for event ${id}`);
    } else if (algorithm === 'rsa-sha256' || !algorithm) {
      let ok = false;
      try {
        ok = crypto.verify(
          'sha256',
          concat,
          { key: keyObj, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
          sigBuf
        );
      } catch (e) {
        ok = false;
      }
      if (!ok) {
        try {
          ok = crypto.verify(
            'sha256',
            concat,
            { key: keyObj, padding: crypto.constants.RSA_PKCS1_PADDING },
            sigBuf
          );
        } catch (e) {
          ok = false;
        }
      }
      if (!ok) throw new Error(`Signature verification failed for event ${id}`);
    } else {
      throw new Error(`Unsupported signer algorithm "${algorithm}" for event ${id}`);
    }

    expectedPrevHash = hashHex;
    headHash = hashHex;
  }

  return headHash;
}

/* -------------------------------------------------------------------------- */
/*                           DB helpers / orchestration                        */
/* -------------------------------------------------------------------------- */

async function fetchEvents(client, { limit = 200, since = null } = {}) {
  const clauses = ['signature IS NOT NULL'];
  const params = [];

  if (since) {
    params.push(since);
    clauses.push(`ts >= $${params.length}`);
  }

  let sql = `
    SELECT id, event_type, payload, prev_hash, hash, signature, signer_id, ts
    FROM audit_events
  `;
  if (clauses.length) {
    sql += ' WHERE ' + clauses.join(' AND ');
  }
  sql += ' ORDER BY ts DESC';

  if (limit && Number.isFinite(limit)) {
    params.push(Number(limit));
    sql += ` LIMIT $${params.length}`;
  }

  const res = await client.query(sql, params);
  return res.rows.reverse(); // oldest -> newest for prev_hash checks
}

async function verifyAuditChain({ databaseUrl = DEFAULT_DB_URL, signerMap, limit = 200, since = null } = {}) {
  if (!signerMap) {
    throw new Error('signerMap is required');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const events = await fetchEvents(client, { limit, since });
    if (!events.length) {
      log('No signed audit_events found (nothing to verify).');
      return null;
    }
    const head = verifyEvents(events, signerMap);
    return head;
  } finally {
    await client.end().catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/*                                   CLI                                     */
/* -------------------------------------------------------------------------- */

function parseArgs(argv = process.argv) {
  const args = Array.from(argv.slice(2));
  const opts = {
    databaseUrl: DEFAULT_DB_URL,
    signersPath: DEFAULT_SIGNERS_PATH,
    limit: 200,
    since: null
  };

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '-d' || a === '--database-url') {
      opts.databaseUrl = args[++i];
    } else if (a === '-s' || a === '--signers') {
      opts.signersPath = args[++i];
    } else if (a === '--limit') {
      opts.limit = Number(args[++i]);
    } else if (a === '--since') {
      opts.since = args[++i];
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: node kernel/tools/audit-verify.js --database-url <url> --signers <signers.json> [--limit N] [--since YYYY-MM-DD]');
      process.exit(0);
    }
  }

  return opts;
}

function loadSignerMap(signersPath) {
  const resolved = path.resolve(signersPath || DEFAULT_SIGNERS_PATH);
  if (!fs.existsSync(resolved)) {
    throw new Error(`signers.json not found at ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`failed to parse signers file: ${e.message}`);
  }
  return parseSignerRegistry(parsed);
}

async function main() {
  const opts = parseArgs(process.argv);
  let signerMap;
  try {
    signerMap = loadSignerMap(opts.signersPath);
  } catch (e) {
    err(e.message || e);
    process.exit(1);
    return;
  }

  try {
    const head = await verifyAuditChain({
      databaseUrl: opts.databaseUrl,
      signerMap,
      limit: opts.limit,
      since: opts.since
    });
    if (head) {
      log(`Verification completed: head hash ${head}`);
    } else {
      log('Verification completed: no events verified');
    }
  } catch (e) {
    err('Verification failed:', e.message || e);
    process.exit(2);
    return;
  }
}

if (require.main === module) {
  main().catch((e) => {
    err('Fatal error:', e.message || e);
    process.exit(1);
  });
}

module.exports = {
  canonicalize,
  parseSignerRegistry,
  createKeyObject,
  verifyEvents,
  fetchEvents,
  verifyAuditChain
};
