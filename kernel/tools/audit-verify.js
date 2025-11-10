#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const ED25519_SPki_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

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

function parseSignerRegistry(raw) {
  if (!raw || (typeof raw !== 'object' && !Array.isArray(raw))) throw new Error('Signer registry must be object or array');
  let entries;
  if (Array.isArray(raw)) entries = raw;
  else if (Array.isArray(raw.signers)) entries = raw.signers;
  else {
    entries = Object.keys(raw).map((id) => {
      const val = raw[id];
      return typeof val === 'string' ? { signerId: id, publicKey: val, algorithm: 'Ed25519' } : { signerId: id, ...(val || {}) };
    });
  }

  const map = new Map();
  for (const e of entries) {
    if (!e) continue;
    const signerId = e.signerId || e.signer_id || e.id;
    let publicKey = e.publicKey || e.public_key;
    let alg = (e.algorithm || e.alg || 'Ed25519').toLowerCase();
    if (!signerId || !publicKey) throw new Error('Each signer needs signerId + publicKey');
    alg = alg.includes('rsa') ? 'rsa-sha256' : alg.includes('ed25519') ? 'Ed25519' : (() => { throw new Error(`Bad alg ${alg}`); })();
    publicKey = typeof publicKey === 'string' ? publicKey.trim() : publicKey;
    if (alg === 'Ed25519') {
      const buf = Buffer.from(publicKey, 'base64');
      if (buf.length !== 32) throw new Error(`Ed25519 key for ${signerId} invalid length`);
    }
    map.set(signerId, { publicKey, algorithm: alg });
  }
  return map;
}

function createKeyObject(publicKeyStr, alg) {
  if (alg === 'Ed25519') {
    const raw = Buffer.from(publicKeyStr, 'base64');
    const spki = Buffer.concat([ED25519_SPki_PREFIX, raw]);
    return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
  }
  if (alg === 'rsa-sha256') {
    const trimmed = publicKeyStr.trim();
    if (trimmed.startsWith('-----BEGIN')) return crypto.createPublicKey(trimmed);
    const der = Buffer.from(trimmed, 'base64');
    return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  }
  throw new Error(`Unsupported algorithm: ${alg}`);
}

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

    const canonical = canonicalize(row.payload ?? null);
    const prevBytes = storedPrev ? Buffer.from(storedPrev, 'hex') : Buffer.alloc(0);
    const hashBytes = crypto.createHash('sha256').update(Buffer.concat([canonical, prevBytes])).digest();
    const computedHash = hashBytes.toString('hex');

    if (expectedPrev && storedPrev !== expectedPrev)
      throw new Error(`prev_hash mismatch for ${id}: expected ${expectedPrev} got ${storedPrev}`);

    let keyObj = keyCache.get(signerId);
    if (!keyObj) {
      keyObj = createKeyObject(signer.publicKey, signer.algorithm);
      keyCache.set(signerId, keyObj);
    }

    const sig = Buffer.from(sigB64, 'base64');
    if (signer.algorithm === 'Ed25519') {
      if (!crypto.verify(null, hashBytes, keyObj, sig)) throw new Error(`Ed25519 verify failed for ${id}`);
    } else if (signer.algorithm === 'rsa-sha256') {
      const msg = Buffer.concat([canonical, prevBytes]);
      const paddings = [
        { pad: crypto.constants.RSA_PKCS1_PSS_PADDING, opts: { saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST } },
        { pad: crypto.constants.RSA_PKCS1_PADDING, opts: {} },
      ];
      let ok = false;
      for (const p of paddings) {
        try {
          const v = crypto.createVerify('RSA-SHA256');
          v.update(msg);
          v.end();
          ok = v.verify({ key: keyObj, padding: p.pad, ...p.opts }, sig);
          if (ok) break;
        } catch (_) {}
      }
      if (!ok) throw new Error(`RSA-SHA256 verification failed for ${id} (PSS+PKCS1v1.5 both failed)`);
    }

    expectedPrev = computedHash;
    headHash = computedHash;
  }

  return headHash;
}

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

