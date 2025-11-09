// agent-manager/server/test_kms_signer.js
// Minimal smoke test for AWS KMS signing via key_store.signAuditCanonical()
// - Avoids DB entirely; calls key_store.signAuditCanonical() directly.
// - Exits 0 on success, non-zero on failure.

const keyStore = require('./key_store');

async function main() {
  try {
    if (!process.env.AUDIT_SIGNING_KMS_KEY_ID) {
      throw new Error('Set AUDIT_SIGNING_KMS_KEY_ID (KMS key ARN/ID).');
    }

    // Ensure we trigger the KMS path
    process.env.AUDIT_SIGNING_KEY_SOURCE = process.env.AUDIT_SIGNING_KEY_SOURCE || 'kms';

    // Choose algorithm (hmac-sha256 / rsa-sha256 / ed25519)
    const alg = process.env.AUDIT_SIGNING_ALG || 'hmac-sha256';
    console.log('Using AUDIT_SIGNING_ALG =', alg);

    // Canonical string - same shape audit_signer uses (string)
    const canonical = JSON.stringify({
      actor_id: 'kms-test',
      event_type: 'kms-test-event',
      payload: { ts: Date.now() },
      prev_hash: null
    });

    console.log('Calling key_store.signAuditCanonical(...)');
    const res = await keyStore.signAuditCanonical(canonical);

    console.log('KMS sign result:', res);

    if (!res || !res.signature) {
      console.error('ERROR: No signature returned. Check AWS credentials, key id, permissions, and that @aws-sdk/client-kms is installed.');
      process.exit(2);
    }

    // Basic checks
    if (!res.kid) {
      console.warn('Warning: signer KID not present in response (expected KMS key id).');
    }

    console.log('OK: signature present (base64 length =', res.signature.length, ')');
    process.exit(0);
  } catch (err) {
    console.error('KMS TEST ERROR', err);
    process.exit(3);
  }
}

main();

