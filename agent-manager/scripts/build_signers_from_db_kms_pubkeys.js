#!/usr/bin/env node
// scripts/build_signers_from_db_kms_pubkeys.js
// Fetch distinct signer_kid from audit_events, call KMS GetPublicKey for each KID,
// convert to PEM/SPKI and write kernel/tools/signers.json
//
// Prereqs: set DATABASE_URL (or POSTGRES_URL) and AWS_REGION and have AWS creds/role available.
// Run from repo root: node scripts/build_signers_from_db_kms_pubkeys.js

const fs = require('fs');
const crypto = require('crypto');
const { Client } = require('pg');
const { KMSClient, GetPublicKeyCommand } = require('@aws-sdk/client-kms');

async function main() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!dbUrl) {
    console.error('ERROR: Set DATABASE_URL (or POSTGRES_URL) to your Postgres connection string.');
    process.exit(2);
  }
  const region = process.env.AWS_REGION || 'us-east-1';

  const pg = new Client({ connectionString: dbUrl });
  await pg.connect();
  try {
    const res = await pg.query("SELECT DISTINCT signer_kid FROM audit_events WHERE signer_kid IS NOT NULL");
    const kids = res.rows.map(r => r.signer_kid).filter(Boolean);
    if (!kids.length) {
      console.error('No signer_kid rows found in audit_events.');
      process.exit(3);
    }

    const kms = new KMSClient({ region });
    const signers = [];

    for (const kid of kids) {
      try {
        // Attempt to get public key from KMS
        const resp = await kms.send(new GetPublicKeyCommand({ KeyId: kid }));
        if (!resp || !resp.PublicKey) {
          console.warn(`KMS returned no PublicKey for ${kid}, skipping.`);
          continue;
        }
        const der = Buffer.from(resp.PublicKey); // DER-encoded SPKI
        const pubKeyObj = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
        // Export as PEM for readability
        const pem = pubKeyObj.export({ type: 'spki', format: 'pem' }).toString('utf8');

        // Pick algorithm based on key type (default to rsa-sha256)
        let alg = 'rsa-sha256';
        try {
          if (pubKeyObj.asymmetricKeyType === 'ed25519') alg = 'Ed25519';
          else if (pubKeyObj.asymmetricKeyType === 'rsa') alg = 'rsa-sha256';
        } catch (e) {
          // ignore and leave default
        }

        signers.push({
          signerId: kid,
          publicKey: pem,
          algorithm: alg
        });
      } catch (e) {
        console.warn(`Failed to fetch/parse public key for ${kid}: ${e.message || e}`);
      }
    }

    if (!signers.length) {
      console.error('No signers could be built. Check AWS creds/permissions and that signer_kid values correspond to KMS keys.');
      process.exit(4);
    }

    const out = { signers };
    fs.mkdirSync('kernel/tools', { recursive: true });
    fs.writeFileSync('kernel/tools/signers.json', JSON.stringify(out, null, 2), 'utf8');
    console.log(`Wrote kernel/tools/signers.json with ${signers.length} signer(s).`);
    process.exit(0);
  } finally {
    try { await pg.end(); } catch (e) {}
  }
}

main().catch(err => {
  console.error('ERROR', err.message || err);
  process.exit(1);
});

