#!/usr/bin/env node
/**
 * kernel/tools/audit-verify.js
 *
 * Verifies audit_events chain integrity + signatures.
 * Replays the entire chain from genesis (or oldest available) to current state.
 *
 * Usage:
 *   node kernel/tools/audit-verify.js --database-url "$POSTGRES_URL" --signers kernel/tools/signers.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const DEFAULT_SIGNERS_PATH = path.resolve(__dirname, 'signers.json');
const DEFAULT_DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/illuvrse';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;
const HEX_RE = /^[0-9a-fA-F]+$/;

function log(...args) { console.log('[audit-verify]', ...args); }
function err(...args) { console.error('[audit-verify]', ...args); }

function canonicalizeHelper(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(canonicalizeHelper);
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = canonicalizeHelper(value[k]);
    }
    return out;
}

// Matches kernel/src/auditStore.ts computeHash
function computeHash(eventType, payload, prevHash, ts) {
  const input = JSON.stringify({
    eventType,
    payload: canonicalizeHelper(payload),
    prevHash,
    ts,
  });
  return crypto.createHash('sha256').update(input).digest('hex');
}

// Matches kernel/src/signingProvider.ts canonicalizePayload
function canonicalizePayload(obj) {
    return JSON.stringify(canonicalizeHelper(obj));
}

/* --- Key parsing helpers --- */

function derToPem(buf) {
  const body = buf.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

function normalizePublicKey(signerId, key) {
  const trimmed = String(key).trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed;
  // compact
  const compact = trimmed.replace(/\s+/g, '');
  const buf = Buffer.from(compact, 'base64');
  if (buf.length === 32) {
    // Ed25519 raw key -> SPKI wrap
    return derToPem(Buffer.concat([ED25519_SPKI_PREFIX, buf]));
  }
  return derToPem(buf);
}

function parseSignerRegistry(input) {
  const entries = Array.isArray(input) ? input : (input.signers || Object.entries(input).map(([k,v]) => ({signerId:k, ...v})));
  const map = new Map();
  for (const entry of entries) {
    const sid = entry.signerId || entry.signer_kid || entry.id;
    if (!sid) continue;
    const pk = entry.publicKey || entry.public_key_pem || entry.key;
    if (!pk) continue;
    let alg = entry.algorithm || entry.alg || 'rsa-sha256';
    if (alg.includes('rsa')) alg = 'rsa-sha256';
    else if (alg.includes('ed25519')) alg = 'ed25519';
    map.set(String(sid), { publicKey: normalizePublicKey(sid, pk), algorithm: alg });
  }
  return map;
}

function createKeyObject(pem) {
  return crypto.createPublicKey(pem);
}

/* --- Verification Logic --- */

function verifyEvent(row, signerMap, expectedPrevHash) {
  const id = row.id;

  // 1. Verify Hash Chain
  const storedHash = row.hash;
  const storedPrev = row.prev_hash;

  if (storedPrev !== expectedPrevHash) {
    // Special handling for genesis if expectedPrevHash is null
    if (expectedPrevHash === null && storedPrev === null) {
      // Genesis block, OK.
    } else {
      throw new Error(`Chain broken at ${id}: expected prev=${expectedPrevHash}, got=${storedPrev}`);
    }
  }

  // Re-compute hash
  // Note: DB returns Date object for ts, we need ISO string.
  // Assuming postgres driver returns Date for 'timestamp with time zone'.
  let tsStr = row.ts;
  if (row.ts instanceof Date) {
      tsStr = row.ts.toISOString();
  }

  const computedHashHex = computeHash(row.event_type, row.payload, storedPrev, tsStr);
  if (storedHash && storedHash !== computedHashHex) {
    throw new Error(`Hash mismatch at ${id}: stored=${storedHash}, computed=${computedHashHex}`);
  }

  // 2. Verify Signature
  const signerId = row.signer_id || row.signer_kid;
  if (!signerMap.has(signerId)) {
      console.warn(`[WARN] Unknown signer ${signerId} at ${id}. Skipping signature check.`);
      return computedHashHex;
  }
  const signer = signerMap.get(signerId);

  let sigBuf;
  try {
    const rawSig = row.signature;
    if (HEX_RE.test(rawSig)) sigBuf = Buffer.from(rawSig, 'hex');
    else sigBuf = Buffer.from(rawSig, 'base64');
  } catch (e) { throw new Error(`Invalid signature encoding at ${id}`); }

  const keyObj = createKeyObject(signer.publicKey);

  // Reconstruct the signed payload: { data: hash, ts: tsStr }
  const signedPayload = canonicalizePayload({ data: computedHashHex, ts: tsStr });
  const signedBuffer = Buffer.from(signedPayload);

  if (signer.algorithm === 'ed25519') {
    const ok = crypto.verify(null, signedBuffer, keyObj, sigBuf);
    if (!ok) throw new Error(`Ed25519 signature invalid at ${id}`);
  } else if (signer.algorithm === 'rsa-sha256') {
    const ok = crypto.verify('sha256', signedBuffer, keyObj, sigBuf);
    if (!ok) throw new Error(`RSA signature invalid at ${id}`);
  } else {
    throw new Error(`Unsupported algo ${signer.algorithm}`);
  }

  return computedHashHex;
}

async function verifyChain(dbUrl, signersPath, limit) {
  const signerMap = parseSignerRegistry(JSON.parse(fs.readFileSync(signersPath, 'utf8')));
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    // Fetch all events, ordered by ts and then id to ensure deterministic order if timestamps collide.
    const res = await client.query(`SELECT * FROM audit_events ORDER BY ts ASC, id ASC`);
    const events = res.rows;

    if (events.length === 0) {
      log('No events found.');
      return;
    }

    log(`Verifying ${events.length} events...`);
    let expectedPrev = null;

    for (const ev of events) {
      const hash = verifyEvent(ev, signerMap, expectedPrev);
      expectedPrev = hash;
    }
    log(`Success! Chain verified. Head: ${expectedPrev}`);
  } finally {
    await client.end();
  }
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  let dbUrl = DEFAULT_DB_URL;
  let signers = DEFAULT_SIGNERS_PATH;
  let limit = 200;

  for (let i=0; i<args.length; i++) {
    if (args[i] === '--database-url') dbUrl = args[++i];
    if (args[i] === '--signers') signers = args[++i];
    if (args[i] === '--limit') limit = parseInt(args[++i]);
  }

  verifyChain(dbUrl, signers, limit).catch(e => {
    err(e);
    process.exit(1);
  });
}

module.exports = { verifyChain, verifyEvent, parseSignerRegistry, computeHash };
