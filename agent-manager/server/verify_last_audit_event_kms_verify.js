#!/usr/bin/env node
// agent-manager/scripts/verify_last_audit_event_kms_verify.js
//
// Verify the last audit event signature using AWS KMS Verify/VerifyMac.
// Usage: node verify_last_audit_event_kms_verify.js
//
// Requires:
//  - DATABASE_URL (Postgres)
//  - AWS credentials and region env vars if using KMS (AWS_REGION or AWS_DEFAULT_REGION)
//  - @aws-sdk/client-kms installed for KMS interactions
//
// This script mirrors the digest signing semantics used in production:
//   hash = SHA256( canonical(payload) || prevHashBytes )
// and verifies the signature against that hash.

const crypto = require('crypto');
const db = require('../server/db');
const auditSigner = require('../server/audit_signer'); // reuses canonicalize
const { KMSClient, VerifyCommand, VerifyMacCommand, GetPublicKeyCommand } = (() => {
  try {
    return require('@aws-sdk/client-kms');
  } catch (e) {
    // We'll surface a clearer error below if KMS calls are attempted without the SDK.
    return {};
  }
})();

function hexToBufferSafe(hex) {
  if (!hex) return Buffer.alloc(0);
  return Buffer.from(hex, 'hex');
}

async function inferAlgFromKms(client, keyId) {
  // Try to call GetPublicKey to inspect SigningAlgorithms / KeySpec
  try {
    if (!GetPublicKeyCommand) {
      return null;
    }
    const gcmd = new GetPublicKeyCommand({ KeyId: keyId });
    const gres = await client.send(gcmd);
    // prefer explicit SigningAlgorithms
    if (gres && Array.isArray(gres.SigningAlgorithms)) {
      if (gres.SigningAlgorithms.includes('RSASSA_PKCS1_V1_5_SHA_256')) return 'rsa-sha256';
      if (gres.SigningAlgorithms.includes('ED25519')) return 'ed25519';
      // other checks can be added here (ECDSA, etc.)
    }
    // fallback to KeySpec heuristics
    if (gres && gres.KeySpec) {
      const ks = String(gres.KeySpec).toUpperCase();
      if (ks.startsWith('RSA')) return 'rsa-sha256';
      if (ks.includes('ED25519') || ks.includes('ED25519')) return 'ed25519';
    }
  } catch (e) {
    // If key is symmetric or GetPublicKey not allowed, inference will fail; return null
    return null;
  }
  return null;
}

async function kmsVerify(hashBuf, signatureBuf, keyId, alg, region) {
  if (!KMSClient) {
    throw new Error('@aws-sdk/client-kms is required for KMS verification. Install it or choose a different verification path.');
  }
  const client = new KMSClient({ region });

  if (alg === 'hmac-sha256') {
    if (!VerifyMacCommand) throw new Error('VerifyMacCommand not available in AWS SDK.');
    const cmd = new VerifyMacCommand({
      KeyId: keyId,
      Message: hashBuf,
      Mac: signatureBuf,
      MacAlgorithm: 'HMAC_SHA_256'
    });
    const resp = await client.send(cmd);
    return !!(resp && resp.MacValid);
  }

  if (alg === 'rsa-sha256') {
    if (!VerifyCommand) throw new Error('VerifyCommand not available in AWS SDK.');
    const cmd = new VerifyCommand({
      KeyId: keyId,
      Message: hashBuf,
      MessageType: 'DIGEST',
      Signature: signatureBuf,
      SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256'
    });
    const resp = await client.send(cmd);
    return !!(resp && resp.SignatureValid);
  }

  if (alg === 'ed25519') {
    if (!VerifyCommand) throw new Error('VerifyCommand not available in AWS SDK.');
    // For Ed25519 we send the precomputed digest bytes as-is (same shape used for signing)
    const cmd = new VerifyCommand({
      KeyId: keyId,
      Message: hashBuf,
      Signature: signatureBuf,
      SigningAlgorithm: 'ED25519'
    });
    const resp = await client.send(cmd);
    return !!(resp && resp.SignatureValid);
  }

  throw new Error(`Unsupported alg for KMS verify: ${alg}`);
}

function canonicalizePayload(payload) {
  // Reuse canonicalizer from audit_signer
  return auditSigner.canonicalize(payload);
}

async function main() {
  try {
    // Ensure DB pool
    if (typeof db.init === 'function') {
      db.init();
    }

    const res = await db.query(
      `SELECT id, actor_id, event_type, payload, signature, signer_kid, prev_hash, created_at
       FROM audit_events
       ORDER BY created_at DESC
       LIMIT 1`
    );

    const row = res.rows[0];
    if (!row) {
      console.error('No audit events found in DB.');
      process.exit(2);
    }

    console.log(`Found audit event id=${row.id} created_at=${row.created_at}`);
    const payload = row.payload || {};
    const signatureB64 = row.signature;
    const signerKid = row.signer_kid || process.env.AUDIT_SIGNING_KMS_KEY_ID;

    if (!signatureB64) {
      console.error('Last audit event is unsigned (signature is null). Nothing to verify.');
      process.exit(3);
    }

    if (!signerKid) {
      console.error('No signer_kid on event and AUDIT_SIGNING_KMS_KEY_ID not set; cannot determine KMS key id.');
      process.exit(4);
    }

    // 1) build canonical(payload)
    const canonicalPayload = canonicalizePayload(payload); // returns string
    const canonicalBuf = Buffer.from(canonicalPayload, 'utf8');

    // 2) prevHashBytes
    const prevHashBuf = hexToBufferSafe(row.prev_hash);

    // 3) compute concatenated and the final hash
    const concat = Buffer.concat([canonicalBuf, prevHashBuf]);
    const hashBuf = crypto.createHash('sha256').update(concat).digest();

    // 4) signature bytes
    const signatureBuf = Buffer.from(signatureB64, 'base64');

    // Determine algorithm: prefer env var, otherwise try to infer from KMS
    let alg = (process.env.AUDIT_SIGNING_ALG || '').toLowerCase() || null;
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

    if (!alg) {
      // Attempt to infer using GetPublicKey (works for asymmetric keys)
      if (!KMSClient || !GetPublicKeyCommand) {
        console.warn('AWS SDK not available to infer key algorithm. Set AUDIT_SIGNING_ALG in env or install @aws-sdk/client-kms.');
      } else {
        try {
          const client = new KMSClient({ region });
          const inferred = await inferAlgFromKms(client, signerKid);
          if (inferred) {
            alg = inferred;
            console.log(`Inferred key algorithm from KMS metadata: ${alg}`);
          }
        } catch (e) {
          // ignore inference errors
        }
      }
    }

    // If still unknown, fall back to 'rsa-sha256' (common). But warn the user.
    if (!alg) {
      console.warn('Could not determine algorithm automatically. Defaulting to "rsa-sha256". Set AUDIT_SIGNING_ALG to avoid guessing.');
      alg = 'rsa-sha256';
    }

    console.log(`Verifying using keyId='${signerKid}' alg='${alg}' region='${region}'`);

    // 5) Attempt KMS verify path
    let verified = false;
    try {
      verified = await kmsVerify(hashBuf, signatureBuf, signerKid, alg, region);
    } catch (e) {
      console.error('KMS verification failed with error:', e.message || e);
      process.exit(5);
    }

    if (verified) {
      console.log('VERIFIED: KMS reports signature valid for last audit event.');
      process.exit(0);
    } else {
      console.error('NOT VERIFIED: KMS reports signature invalid for last audit event.');
      process.exit(6);
    }
  } catch (err) {
    console.error('Error running verification script:', err && err.stack ? err.stack : err);
    process.exit(10);
  } finally {
    try {
      if (typeof db.close === 'function') await db.close();
    } catch (e) {
      // ignore
    }
  }
}

if (require.main === module) {
  main();
}

