// agent-manager/server/audit_signer.js
// Audit event signer + append-only prev_hash chain for Agent Manager.
// Uses key_store.signAuditCanonical() when available for signing.
// Falls back to env-based signing if key_store doesn't provide a key.
//
// Exports:
//  - createSignedAuditEvent(actorId, eventType, payload)
//    -> creates an audit event in DB, signed and linked to previous event via prev_hash.
//
// NOTE: For production, replace key_store with a KMS/HSM-backed provider.

const crypto = require('crypto');
const db = require('./db');
const keyStore = require('./key_store');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
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
 * Compute prev_hash from last event, canonicalize current event (actor/event/payload/prev_hash),
 * sign it using key_store.signAuditCanonical() if available, otherwise fall back to env-based signing,
 * and persist using db.createAuditEvent(actorId,eventType,payload,signature,signerKid,prev_hash).
 *
 * Returns an object with { id, created_at, signature, signer_kid, prev_hash }.
 */
async function createSignedAuditEvent(actorId = null, eventType, payload = {}) {
  // 1) determine prev_hash
  const last = await getLastAuditEventRow();
  let prev_hash = null;
  if (last) {
    const lastForHash = {
      id: last.id,
      actor_id: last.actor_id,
      event_type: last.event_type,
      payload: last.payload,
      signature: last.signature,
      signer_kid: last.signer_kid,
      prev_hash: last.prev_hash,
      created_at: last.created_at
    };
    prev_hash = sha256Hex(canonicalize(lastForHash));
  }

  // 2) canonicalize current event to sign
  const eventToSign = {
    actor_id: actorId,
    event_type: eventType,
    payload: payload,
    prev_hash: prev_hash
  };
  const canonical = canonicalize(eventToSign);

  // 3) try key_store signing
  let signature = null;
  let signerKid = process.env.AUDIT_SIGNER_KID || 'local';
  try {
    const signed = await keyStore.signAuditCanonical(canonical);
    if (signed && signed.signature) {
      signature = signed.signature;
      signerKid = signed.kid || signerKid;
    } else {
      // fallback: try env-based signing (preserve previous behavior)
      const envKey = process.env.AUDIT_SIGNING_PRIVATE_KEY || null;
      const alg = (process.env.AUDIT_SIGNING_ALG || 'hmac-sha256').toLowerCase();
      signerKid = process.env.AUDIT_SIGNER_KID || signerKid;
      if (envKey) {
        if (alg === 'hmac-sha256') {
          signature = crypto.createHmac('sha256', envKey).update(Buffer.from(canonical)).digest('base64');
        } else if (alg === 'rsa-sha256' || alg === 'rsa') {
          signature = crypto.sign('sha256', Buffer.from(canonical), envKey).toString('base64');
        } else if (alg === 'ed25519') {
          signature = crypto.sign(null, Buffer.from(canonical), envKey).toString('base64');
        } else {
          // unsupported env alg -> leave signature null
        }
      }
    }
  } catch (e) {
    // Log and continue — we still persist the event (unsigned) to avoid losing audit events.
    console.error('audit_signer: signing error', e);
    // attempt env fallback
    try {
      const envKey = process.env.AUDIT_SIGNING_PRIVATE_KEY || null;
      const alg = (process.env.AUDIT_SIGNING_ALG || 'hmac-sha256').toLowerCase();
      signerKid = process.env.AUDIT_SIGNER_KID || signerKid;
      if (envKey) {
        if (alg === 'hmac-sha256') {
          signature = crypto.createHmac('sha256', envKey).update(Buffer.from(canonical)).digest('base64');
        } else if (alg === 'rsa-sha256' || alg === 'rsa') {
          signature = crypto.sign('sha256', Buffer.from(canonical), envKey).toString('base64');
        } else if (alg === 'ed25519') {
          signature = crypto.sign(null, Buffer.from(canonical), envKey).toString('base64');
        }
      }
    } catch (e2) {
      console.error('audit_signer: env fallback signing error', e2);
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

