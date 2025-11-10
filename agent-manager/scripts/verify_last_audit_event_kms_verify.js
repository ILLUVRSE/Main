// agent-manager/scripts/verify_last_audit_event_kms_verify.js
// Recreate the canonical string for the most-recent audit event and call AWS KMS Verify
// Usage: ensure DATABASE_URL/POSTGRES_URL, AWS_REGION and AWS creds are set, then run:
//   node agent-manager/scripts/verify_last_audit_event_kms_verify.js

const crypto = require('crypto');
const db = require('../server/db');
const { KMSClient, VerifyCommand } = require('@aws-sdk/client-kms');

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

    const eventToSign = {
      actor_id: row.actor_id,
      event_type: row.event_type,
      payload: row.payload,
      prev_hash: row.prev_hash
    };
    const canonical = canonicalize(eventToSign);
    console.log('Canonical:', canonical);

    const kms = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });

    const signature = Buffer.from(row.signature, 'base64');

    // VERIFY: use the canonical message (RAW) with the same algorithm the signer used.
    // The KMS Sign in agent-manager.key_store_kms_adapter uses RSASSA_PKCS1_V1_5_SHA_256
    const verifyCmd = new VerifyCommand({
      KeyId: row.signer_kid,
      Message: Buffer.from(canonical),
      Signature: signature,
      SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256'
    });

    try {
      const resp = await kms.send(verifyCmd);
      console.log('KMS Verify (RAW canonical) result for id=%s: %s', row.id, resp && resp.SignatureValid);
    } catch (err) {
      console.error('KMS Verify (RAW canonical) ERROR:', err && err.name ? `${err.name}: ${err.message}` : err);
      // If this errors with ValidationException, the exact error message will be printed above.
    }

  } catch (err) {
    console.error('ERROR', err && err.message ? err.message : err);
    process.exit(1);
  } finally {
    try { await db.close(); } catch (e) {}
  }
}

main();

