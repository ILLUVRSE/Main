#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const ED25519_SPki_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/* ---------- Canonicalization (same rules used by agent-manager) ---------- */
function canonicalize(value) {
  if (value === null || value === undefined) return Buffer.from('null');
  if (typeof value === 'boolean') return Buffer.from(value ? 'true' : 'false');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number: ${value}`);
    return Buffer.from(JSON.stringify(value));
  }
  if (typeof value === 'string') return Buffer.from(JSON.stringify(value));
  if (Array.isArray(value)) {
    const parts = value.map((x) => canonicalize(x));
    return Buffer.from(`[${parts.map((b) => b.toString('utf8')).join(',')}]`);
  }
  if (typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key]).toString('utf8')}`);
    return Buffer.from(`{${entries.join(',')}}`);
  }
  return Buffer.from(JSON.stringify(value));
}

/* ---------- Signer registry parsing ---------- */
function parseSignerRegistry(raw) {
  if (!raw || (typeof raw !== 'object' && !Array.isArray(raw))) throw new Error('Signer registry must be object or array');
  let entries;
  if (Array.isArray(raw)) entries = raw;
  else if (Array.isArray(raw.signers)) entries = raw.signers;
  else {
    entries = Object.keys(raw).map((id) => {
      const val = raw[id];
      return typeof val === 'string' ? { signerId: id, publicKey: val } : { signerId: id, ...(val || {}) };
    });
  }

  const map = new Map();
  for (const e of entries) {
    if (!e) continue;
    const signerId = e.signerId || e.signer_id || e.id;
    let publicKey = e.publicKey || e.public_key;
    let algRaw = (e.algorithm || e.alg || '').toString();
    if (!signerId || !publicKey) throw new Error('Each signer needs signerId + publicKey');

    // Normalize algorithm if present; otherwise leave undefined so we can infer later.
    let normalized;
    if (algRaw && algRaw.trim() !== '') {
      const a = algRaw.toLowerCase();
      if (a.includes('rsa')) normalized = 'rsa-sha256';
      else if (a.includes('ed25519')) normalized = 'ed25519';
      else throw new Error(`Bad alg ${algRaw} for signer ${signerId}`);
    } else {
      normalized = undefined;
    }

    publicKey = typeof publicKey === 'string' ? publicKey.trim() : publicKey;

    // Basic validation for Ed25519 when the registry explicitly states ed25519 or when key looks raw
    if (normalized === 'ed25519' || (!normalized && !publicKey.startsWith('-----BEGIN'))) {
      if (!publicKey.startsWith('-----BEGIN')) {
        const buf = Buffer.from(publicKey, 'base64');
        if (buf.length !== 32 && buf.length !== 0) {
          throw new Error(`Public key for ${signerId} invalid length`);
        }
      }
    }

    map.set(signerId, { publicKey, algorithm: normalized });
  }
  return map;
}

/* ---------- Public key construction (infer from content) ---------- */
/**
 * createKeyObject(publicKeyStr[, alg])
 *
 * Accepts:
 *  - PEM string (-----BEGIN PUBLIC KEY-----...)
 *  - base64 DER/SPKI (string)
 *  - base64 raw 32-byte Ed25519 public key (string)
 *
 * If alg is supplied it is not strictly required; we infer the algorithm from the key material when needed.
 */
function createKeyObject(publicKeyStr, alg) {
  if (!publicKeyStr || typeof publicKeyStr !== 'string') throw new Error('publicKeyStr is required');

  const trimmed = publicKeyStr.trim();

  // PEM first (accept RSA/SPKI or Ed25519 PEM)
  if (trimmed.startsWith('-----BEGIN')) {
    return crypto.createPublicKey(trimmed);
  }

  // otherwise base64 -> buffer
  let buf;
  try {
    buf = Buffer.from(trimmed, 'base64');
  } catch (e) {
    throw new Error(`Public key parse error: invalid base64`);
  }

  // If exact 32 bytes -> raw Ed25519 public key
  if (buf.length === 32) {
    const spki = Buffer.concat([ED25519_SPki_PREFIX, buf]);
    return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
  }

  // Otherwise assume DER/SPKI
  try {
    return crypto.createPublicKey({ key: buf, format: 'der', type: 'spki' });
  } catch (e) {
    throw new Error(`Public key parse error: ${(e && e.message) || e}`);
  }
}

/* ---------- Verification ---------- */
function verifyEvents(events, signerMap) {
  const keyCache = new Map();
  let expectedPrev = '';
  let headHash = '';

  for (const [i, row] of events.entries()) {
    const id = row.id;
    const signerId = row.signer_kid || row.signer_id;
    if (!signerId) throw new Error(`Missing signerId for event ${id}`);
    const signer = signerMap.get(signerId);
    if (!signer) throw new Error(`Unknown signer ${signerId}`);

    const storedPrev = row.prev_hash || '';
    const sigB64 = row.signature;
    if (!sigB64) throw new Error(`Missing signature for ${id}`);

    // canonicalize payload and compute digest/hash per spec:
    // hashBytes = SHA256( canonical(payload) || prevHashBytes )
    const canonical = canonicalize(row.payload ?? null); // Buffer
    const prevBytes = storedPrev ? Buffer.from(storedPrev, 'hex') : Buffer.alloc(0);
    const concat = Buffer.concat([canonical, prevBytes]); // message whose digest we compute
    const hashBytes = crypto.createHash('sha256').update(concat).digest();
    const computedHash = hashBytes.toString('hex');

    // First check prev_hash chain integrity (so tests that mutate prev_hash trigger this).
    if (expectedPrev && storedPrev !== expectedPrev)
      throw new Error(`prevHash mismatch for ${id}: expected ${expectedPrev} got ${storedPrev}`);

    // If test/row includes a stored 'hash' field, ensure it matches computed value.
    if (row.hash && row.hash !== computedHash) {
      throw new Error(`Hash mismatch for ${id}: stored=${row.hash} computed=${computedHash}`);
    }

    // Create or reuse KeyObject
    let keyObj = keyCache.get(signerId);
    if (!keyObj) {
      keyObj = createKeyObject(signer.publicKey, signer.algorithm);
      keyCache.set(signerId, keyObj);
    }

    const sig = Buffer.from(sigB64, 'base64');

    // Determine algorithm to use: prefer explicit signer.algorithm, otherwise infer
    let algToUse = signer.algorithm;
    if (!algToUse) {
      try {
        const aType = (keyObj && keyObj.asymmetricKeyType) ? keyObj.asymmetricKeyType.toLowerCase() : null;
        if (aType === 'ed25519') algToUse = 'ed25519';
        else if (aType === 'rsa') algToUse = 'rsa-sha256';
      } catch (e) {
        // fall through
      }
    }

    if (algToUse === 'ed25519') {
      // Ed25519: verify signature over the digest bytes
      const ok = crypto.verify(null, hashBytes, keyObj, sig);
      if (!ok) throw new Error(`Signature verification failed for ${id}`);
    } else if (algToUse === 'rsa-sha256') {
      // RSA: verify signature on message using SHA-256. Try PSS, then PKCS#1 v1.5.
      let ok = false;
      // Try PSS
      try {
        ok = crypto.verify(
          'sha256',
          concat,
          { key: keyObj, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
          sig
        );
      } catch (e) {
        ok = false;
      }
      // Try PKCS#1 v1.5
      if (!ok) {
        try {
          ok = crypto.verify(
            'sha256',
            concat,
            { key: keyObj, padding: crypto.constants.RSA_PKCS1_PADDING },
            sig
          );
        } catch (e) {
          ok = false;
        }
      }
      if (!ok) throw new Error(`Signature verification failed for ${id}`);
    } else {
      throw new Error(`Unsupported signer algorithm for verification: ${algToUse}`);
    }

    expectedPrev = computedHash;
    headHash = computedHash;
  }

  return headHash;
}

/* ---------- DB fetch / orchestration ---------- */
async function fetchEvents(client) {
  const res = await client.query(`
    SELECT id, event_type, payload, prev_hash, signature, signer_kid
    FROM audit_events
    ORDER BY created_at ASC
  `);
  return res.rows;
}

async function verifyAuditChain({ databaseUrl = process.env.POSTGRES_URL, signerMap }) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const events = await fetchEvents(client);
    const head = verifyEvents(events, signerMap);
    return head;
  } finally {
    await client.end();
  }
}

/* ---------- CLI ---------- */
async function main(argv) {
  const args = argv.slice(2);
  let dbUrl, signersPath;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-d' || args[i] === '--database-url') dbUrl = args[++i];
    else if (args[i] === '-s' || args[i] === '--signers') signersPath = args[++i];
  }
  if (!dbUrl || !signersPath) {
    console.error('Usage: node audit-verify.js -d <db_url> -s <signers.json>');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(path.resolve(signersPath), 'utf8'));
  const signerMap = parseSignerRegistry(raw);
  try {
    const head = await verifyAuditChain({ databaseUrl: dbUrl, signerMap });
    console.log(`Audit chain verified. Head hash: ${head}`);
  } catch (e) {
    console.error('Audit verification failed:', e.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv);

module.exports = { canonicalize, parseSignerRegistry, createKeyObject, verifyEvents, verifyAuditChain };

