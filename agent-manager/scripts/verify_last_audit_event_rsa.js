// scripts/verify_last_audit_event_rsa.js
// Verifies the most recent audit_events row using KMS GetPublicKey + Node crypto.
// Usage: ensure DATABASE_URL and AWS_REGION (and AWS creds) are set, then run:
//    node scripts/verify_last_audit_event_rsa.js

const crypto = require('crypto');
const db = require('../server/db');
const { KMSClient, GetPublicKeyCommand } = require('@aws-sdk/client-kms');

function canonicalize(obj) {
  if (obj === null) return 'null';
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    const parts = keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k]));
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(obj);
}

async function getLastEvent() {
  const res = await db.query(
    `SELECT id, actor_id, event_type, payload, signature, signer_kid, prev_hash, created_at
     FROM audit_events
     ORDER BY created_at DESC
     LIMIT 1`
  );
  return res.rows[0] || null;
}

async function main() {
  try {
    await db.init();
    const row = await getLastEvent();
    if (!row) {
      console.error('No audit events found.');
      process.exit(2);
    }

    // Recreate canonical string the signer used:
    const eventToSign = {
      actor_id: row.actor_id,
      event_type: row.event_type,
      payload: row.payload,
      prev_hash: row.prev_hash
    };
    const canonical = canonicalize(eventToSign);
    console.log('Canonical:', canonical);

    // Call KMS to get public key for signer_kid
    const kms = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const resp = await kms.send(new GetPublicKeyCommand({ KeyId: row.signer_kid }));
    if (!resp || !resp.PublicKey) throw new Error('KMS returned no PublicKey');

    const pubDer = Buffer.from(resp.PublicKey); // DER-encoded SubjectPublicKeyInfo
    const publicKeyObj = crypto.createPublicKey({ key: pubDer, format: 'der', type: 'spki' });

    const sig = Buffer.from(row.signature, 'base64');

    // For RSA we verify using 'sha256'
    const ok = crypto.verify('sha256', Buffer.from(canonical), publicKeyObj, sig);
    console.log(`Verification result for event id=${row.id}:`, ok ? 'OK (signature valid)' : 'FAIL (invalid signature)');

  } catch (err) {
    console.error('ERROR', err);
    process.exit(1);
  } finally {
    try { await db.close(); } catch (e) {}
  }
}

main();

