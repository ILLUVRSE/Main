#!/usr/bin/env node
// kernel/tools/audit-verify.js
// Verify audit_events signatures using signers.json
//
// Usage:
//   POSTGRES_URL="postgresql://postgres:postgres@localhost:5432/illuvrse" node kernel/tools/audit-verify.js --limit 200
//
// Exit code: 0 if all verifications succeeded (or no signed events found), >0 if any failure.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

function log(...args) {
  console.log('[audit-verify]', ...args);
}

function err(...args) {
  console.error('[audit-verify]', ...args);
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = { limit: 200, since: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit' && argv[i + 1]) {
      opts.limit = Number(argv[++i]) || opts.limit;
    } else if (a === '--since' && argv[i + 1]) {
      opts.since = argv[++i];
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: node kernel/tools/audit-verify.js [--limit N] [--since "YYYY-MM-DD"]');
      process.exit(0);
    } else {
      // ignore unknown
    }
  }
  return opts;
}

function readSigners() {
  const p = path.resolve(__dirname, 'signers.json');
  if (!fs.existsSync(p)) {
    throw new Error(`signers.json not found at ${p}`);
  }
  const raw = fs.readFileSync(p, 'utf8');
  try {
    return JSON.parse(raw).signers || [];
  } catch (e) {
    throw new Error('failed to parse signers.json: ' + e.message);
  }
}

function findSigner(signers, signerId) {
  return signers.find((s) => String(s.signerId) === String(signerId));
}

function detectSigFormat(sigStr) {
  if (!sigStr) return 'unknown';
  // base64 has + or / or ends with =
  if (/^[A-Za-z0-9+/=]+$/.test(sigStr)) {
    return 'base64';
  }
  if (/^[0-9a-fA-F]+$/.test(sigStr)) {
    return 'hex';
  }
  return 'base64';
}

function toBufferFromSig(sigStr) {
  if (!sigStr) return null;
  const fmt = detectSigFormat(sigStr);
  if (fmt === 'hex') return Buffer.from(sigStr, 'hex');
  // default base64
  return Buffer.from(sigStr, 'base64');
}

function createPublicKey(keyStr) {
  // accept PEM blobs directly. If keyStr looks like base64 without PEM headers,
  // try to wrap as a PEM for RSA (not ideal) — prefer PEM in signers.json.
  if (!keyStr) throw new Error('empty public key');
  const trimmed = String(keyStr).trim();
  if (trimmed.startsWith('-----BEGIN')) {
    return crypto.createPublicKey(trimmed);
  }
  // Try to guess: assume base64 DER for ED25519 or RSA SPKI
  // Wrap as PEM SPKI for RSA/ED25519
  const b64 = trimmed.replace(/\s+/g, '');
  const pem = `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
  return crypto.createPublicKey(pem);
}

/**
 * Verify a signature for a given hash string (dataString).
 * - For rsa-sha256: createVerify('RSA-SHA256').update(dataString)
 * - For ed25519: crypto.verify(null, Buffer.from(dataString), publicKeyObj, signatureBuffer)
 */
function verifySignature(algorithm, publicKeyStr, dataString, signatureStr) {
  if (!signatureStr) return false;
  const sigBuf = toBufferFromSig(signatureStr);
  if (!sigBuf) return false;

  // Normalize algorithm strings
  const alg = String(algorithm || '').toLowerCase();
  try {
    const pubKey = createPublicKey(publicKeyStr);

    if (alg.includes('ed25519')) {
      // ed25519 verify: crypto.verify(null, data, pubKey, signature)
      const ok = crypto.verify(null, Buffer.from(dataString, 'utf8'), pubKey, sigBuf);
      return !!ok;
    }

    // default: RSA-SHA256
    if (alg.includes('rsa') || alg.includes('sha256')) {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(dataString, 'utf8');
      verifier.end();
      // Node accepts signature as Buffer
      return verifier.verify(pubKey, sigBuf);
    }

    // Fallback try: SHA256 verify
    const verifier = crypto.createVerify('SHA256');
    verifier.update(dataString, 'utf8');
    verifier.end();
    return verifier.verify(pubKey, sigBuf);
  } catch (e) {
    throw new Error('signature verify error: ' + e.message);
  }
}

async function main() {
  const opts = parseArgs();
  const signers = readSigners();
  if (!Array.isArray(signers) || signers.length === 0) {
    log('No signers found in signers.json (nothing to verify).');
  }

  const pgUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/illuvrse';
  const client = new Client({ connectionString: pgUrl });
  await client.connect();

  try {
    let q = `SELECT id, event_type, hash, signature, signer_id, ts FROM audit_events WHERE signature IS NOT NULL ORDER BY ts DESC LIMIT $1`;
    const params = [opts.limit];
    if (opts.since) {
      q = `SELECT id, event_type, hash, signature, signer_id, ts FROM audit_events WHERE signature IS NOT NULL AND ts >= $2 ORDER BY ts DESC LIMIT $1`;
      params.unshift(opts.limit); // adjust order
      params[1] = opts.since;
    }
    const res = await client.query(q, params);
    if (!res.rows.length) {
      log('No signed audit_events found (nothing to verify).');
      process.exit(0);
    }

    let failures = 0;
    for (const row of res.rows) {
      const id = String(row.id);
      const eventType = String(row.event_type || '');
      const hash = String(row.hash || '');
      const signature = row.signature === null ? null : String(row.signature || '');
      const signerId = row.signer_id === null ? null : String(row.signer_id || '');

      const signer = signerId ? findSigner(signers, signerId) : null;
      if (!signer) {
        err(`EVENT ${id} ${eventType}: signer not found: ${signerId}`);
        failures++;
        continue;
      }

      const alg = String(signer.algorithm || 'rsa-sha256');
      const pub = signer.publicKey || signer.key || signer.pub || null;
      if (!pub) {
        err(`EVENT ${id} ${eventType}: signer ${signerId} has no publicKey`);
        failures++;
        continue;
      }

      try {
        const ok = verifySignature(alg, pub, hash, signature);
        if (!ok) {
          err(`EVENT ${id} ${eventType}: signature verification FAILED for signer ${signerId} (alg=${alg})`);
          failures++;
        } else {
          log(`EVENT ${id} ${eventType}: ok (signer=${signerId}, alg=${alg})`);
        }
      } catch (e) {
        err(`EVENT ${id} ${eventType}: verification error: ${e.message}`);
        failures++;
      }
    }

    if (failures > 0) {
      err(`Verification completed: ${failures} failure(s)`);
      process.exit(2);
    } else {
      log(`Verification completed: all ${res.rows.length} events OK`);
      process.exit(0);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((e) => {
  err('Fatal error:', e.message || e);
  process.exit(1);
});

