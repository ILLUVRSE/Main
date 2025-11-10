#!/usr/bin/env node
// Verify one audit_event against AWS KMS directly (tries RAW/DIGEST × PKCS1/PSS)

const { Client } = require('pg');
const crypto = require('crypto');
const { KMSClient, VerifyCommand } = require('@aws-sdk/client-kms');

function canonicalize(value) {
  if (value === null || value === undefined) return Buffer.from('null');
  if (typeof value === 'boolean') return Buffer.from(value ? 'true' : 'false');
  if (typeof value === 'number') return Buffer.from(JSON.stringify(value));
  if (typeof value === 'string') return Buffer.from(JSON.stringify(value));
  if (Array.isArray(value)) {
    const parts = value.map(canonicalize).map((b) => b.toString('utf8'));
    return Buffer.from(`[${parts.join(',')}]`);
  }
  if (typeof value === 'object') {
    const entries = Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(value[k]).toString('utf8')}`);
    return Buffer.from(`{${entries.join(',')}}`);
  }
  return Buffer.from(JSON.stringify(value));
}

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) { console.error('Set DATABASE_URL or POSTGRES_URL'); process.exit(2); }
  const eventId = process.argv[2] || null;

  const pg = new Client({ connectionString: dbUrl });
  await pg.connect();

  const row = eventId
    ? (await pg.query(
        `SELECT id, payload, prev_hash, signature, signer_kid
         FROM audit_events WHERE id = $1`,
        [eventId]
      )).rows[0]
    : (await pg.query(
        `SELECT id, payload, prev_hash, signature, signer_kid
         FROM audit_events ORDER BY created_at DESC LIMIT 1`
      )).rows[0];

  if (!row) { console.error('No event found'); process.exit(3); }

  const { id, payload, prev_hash, signature, signer_kid } = row;
  const canonical = canonicalize(payload ?? null);
  const prevBytes = prev_hash ? Buffer.from(prev_hash, 'hex') : Buffer.alloc(0);
  const message = Buffer.concat([canonical, prevBytes]); // RAW message
  const digest = crypto.createHash('sha256').update(message).digest(); // DIGEST

  if (!signature) { console.error('Missing signature'); process.exit(4); }

  const sig = Buffer.from(signature, 'base64');
  const kms = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });

  const combos = [
    { msgType: 'RAW', algo: 'RSASSA_PSS_SHA_256' },
    { msgType: 'RAW', algo: 'RSASSA_PKCS1_V1_5_SHA_256' },
    { msgType: 'DIGEST', algo: 'RSASSA_PSS_SHA_256' },
    { msgType: 'DIGEST', algo: 'RSASSA_PKCS1_V1_5_SHA_256' },
  ];

  console.log(`Event: ${id}\nKeyId: ${signer_kid}`);
  for (const c of combos) {
    try {
      const params = {
        KeyId: signer_kid,
        Signature: sig,
        SignatureAlgorithm: c.algo,
        MessageType: c.msgType,
        Message: c.msgType === 'RAW' ? message : digest,
      };
      const res = await kms.send(new VerifyCommand(params));
      console.log(`${c.msgType}/${c.algo}: ${res.SignatureValid ? 'VALID' : 'INVALID'}`);
    } catch (e) {
      console.log(`${c.msgType}/${c.algo}: ERROR (${e.name || e.code || e.message})`);
    }
  }

  await pg.end();
}

main().catch((e) => { console.error('ERROR', e.message || e); process.exit(1); });

