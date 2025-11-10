// agent-manager/server/audit_signer.js
// Audit event signer + append-only prev_hash chain for Agent Manager.
// Updated: compute digest = SHA256( canonical(payload) || prevHashBytes )
// and call a digest-signing helper (key_store.signAuditHash or ./signAuditHash).
//
// Exports:
//  - createSignedAuditEvent(actorId, eventType, payload)
//  - canonicalize (for tests/debug)
//  - sha256Hex
//
// Notes:
//  - This module no longer signs the whole canonical event envelope. It computes
//    the digest as specified and delegates digest signing to the configured provider.
//  - The prev_hash persisted for each event is the hex representation of its digest
//    (i.e., the SHA256 result described above) so the chain is: each event points
//    at the hex digest of the previous event.

const crypto = require('crypto');
const db = require('./db');
const keyStore = require('./key_store');

// Prefer the dedicated digest signer helper when available.
let signAuditHashHelper = null;
try {
  signAuditHashHelper = require('./signAuditHash');
} catch (e) {
  // Not present yet — we'll try keyStore.signAuditHash or fall back to env behavior.
  signAuditHashHelper = null;
}

function sha256Hex(input) {
  if (Buffer.isBuffer(input)) {
    return crypto.createHash('sha256').update(input).digest('hex');
  }
  return crypto.createHash('sha256').update(Buffer.from(String(input), 'utf8')).digest('hex');
}

// Deterministic canonical JSON serialization (sorts object keys recursively).
function canonicalize(obj) {
  if (obj === null) return 'null';
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalize).join(',') + ']';
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const parts = keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k]));
    return '{' + parts.join(',') + '}';
  }
  // primitive (string/number/bool)
  return JSON.stringify(obj);
}

async function getLastAuditEventRow() {
  const res = await db.query(
    `SELECT id, actor_id, event_type, payload, signature, signer_kid, prev_hash, created_at
     FROM audit_events
     ORDER BY created_at DESC
     LIMIT 1`
  );
  return res.rows[0] || null;
}

/**
 * createSignedAuditEvent
 * Compute prev_hash from last event (as SHA256(canonical(payload) || prevPrevHashBytes)),
 * compute current hash = SHA256(canonical(payload) || prevHashBytes),
 * sign that hash using key_store.signAuditHash() if available, otherwise use local helper or env fallback,
 * and persist using db.createAuditEvent(actorId,eventType,payload,signature,signerKid,prev_hash).
 *
 * Returns an object with { id, created_at, signature, signer_kid, prev_hash }.
 */
async function createSignedAuditEvent(actorId = null, eventType, payload = {}) {
  // 1) determine prev_hash (the hex SHA256 digest of the last event, per new spec)
  const last = await getLastAuditEventRow();
  let prev_hash = null;
  if (last) {
    // For previous event, its digest = SHA256( canonical(last.payload) || prevHashBytesOfLast )
    const lastPrevBytes = last.prev_hash ? Buffer.from(last.prev_hash, 'hex') : Buffer.alloc(0);
    const lastCanonical = canonicalize(last.payload);
    const lastCanonicalBuf = Buffer.from(lastCanonical, 'utf8');
    const lastConcat = Buffer.concat([lastCanonicalBuf, lastPrevBytes]);
    prev_hash = sha256Hex(lastConcat);
  }

  // 2) canonicalize current payload and compute digest to sign
  const canonicalPayload = canonicalize(payload);
  const canonicalBuf = Buffer.from(canonicalPayload, 'utf8');
  const prevHashBytes = prev_hash ? Buffer.from(prev_hash, 'hex') : Buffer.alloc(0);
  const concat = Buffer.concat([canonicalBuf, prevHashBytes]);
  const hashBuf = crypto.createHash('sha256').update(concat).digest();

  // 3) try signing the digest
  let signature = null;
  let signerKid = process.env.AUDIT_SIGNER_KID || 'local';
  try {
    // Prefer key_store.signAuditHash if implemented (KMS adapter wiring will provide this).
    if (keyStore && typeof keyStore.signAuditHash === 'function') {
      const signed = await keyStore.signAuditHash(hashBuf);
      if (signed && signed.signature) {
        signature = signed.signature;
        signerKid = signed.kid || signerKid;
      } else {
        // If keyStore returned no signature (e.g., KMS configured but no key material locally),
        // fall back to the dedicated helper which will try env-based signing.
        if (signAuditHashHelper && typeof signAuditHashHelper.signAuditHash === 'function') {
          const alt = await signAuditHashHelper.signAuditHash(hashBuf);
          if (alt && alt.signature) {
            signature = alt.signature;
            signerKid = alt.kid || signerKid;
          }
        }
      }
    } else if (signAuditHashHelper && typeof signAuditHashHelper.signAuditHash === 'function') {
      // Use the local helper (handles env keys or KMS via its own logic)
      const signed = await signAuditHashHelper.signAuditHash(hashBuf);
      if (signed && signed.signature) {
        signature = signed.signature;
        signerKid = signed.kid || signerKid;
      }
    } else {
      // Last resort: try env-based signing directly here (best-effort).
      const envKey = process.env.AUDIT_SIGNING_PRIVATE_KEY || null;
      const alg = (process.env.AUDIT_SIGNING_ALG || 'hmac-sha256').toLowerCase();
      signerKid = process.env.AUDIT_SIGNER_KID || signerKid;
      if (envKey) {
        if (alg === 'hmac-sha256') {
          signature = crypto.createHmac('sha256', envKey).update(hashBuf).digest('base64');
        } else if (alg === 'rsa-sha256' || alg === 'rsa') {
          // Wrap digest in DigestInfo and perform private-key operation for PKCS#1 v1.5 signatures.
          // DigestInfo prefix for SHA-256:
          const DIGEST_PREFIX_HEX = '3031300d060960864801650304020105000420';
          const DIGEST_PREFIX = Buffer.from(DIGEST_PREFIX_HEX, 'hex');
          const toSign = Buffer.concat([DIGEST_PREFIX, hashBuf]);
          const signatureBuf = crypto.privateEncrypt(
            { key: envKey, padding: crypto.constants.RSA_PKCS1_PADDING },
            toSign
          );
          signature = signatureBuf.toString('base64');
        } else if (alg === 'ed25519') {
          signature = crypto.sign(null, hashBuf, envKey).toString('base64');
        }
      }
    }
  } catch (e) {
    // Log and continue — we still persist the event (unsigned) to avoid losing audit events.
    console.error('audit_signer: signing error', e);
    try {
      // try local helper fallback if available
      if (signAuditHashHelper && typeof signAuditHashHelper.signAuditHash === 'function') {
        const alt = await signAuditHashHelper.signAuditHash(hashBuf);
        if (alt && alt.signature) {
          signature = alt.signature;
          signerKid = alt.kid || signerKid;
        }
      }
    } catch (e2) {
      console.error('audit_signer: fallback signing error', e2);
    }
  }

  // 4) persist event
  const ev = await db.createAuditEvent(actorId, eventType, payload, signature, signerKid, prev_hash);
  return {
    id: ev.id,
    created_at: ev.created_at,
    signature,
    signer_kid: signerKid,
    prev_hash
  };
}

module.exports = {
  createSignedAuditEvent,
  canonicalize, // exported for testing/debug if needed
  sha256Hex
};

