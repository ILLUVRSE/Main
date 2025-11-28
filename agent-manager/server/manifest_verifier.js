const crypto = require('crypto');
const keyStore = require('./key_store');
const { canonicalize } = require('./audit_signer');

// We use the same verification logic as audit events: SHA256 of canonical payload
async function verifyManifestSignature(signedManifest) {
  if (!signedManifest || !signedManifest.manifest || !signedManifest.signature || !signedManifest.kid) {
    throw new Error('Invalid signed manifest structure');
  }

  const { manifest, signature, kid } = signedManifest;

  // 1. Canonicalize the manifest payload
  const canonicalJson = canonicalize(manifest);
  const hash = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest();

  // 2. Fetch Kernel public key for this kid
  const kernelKeys = await keyStore.getKernelPublicKeys();
  const keyEntry = kernelKeys[kid];

  if (!keyEntry) {
    throw new Error(`Unknown kernel key ID: ${kid}`);
  }

  // 3. Verify
  const sigBuf = Buffer.from(signature, 'base64');
  let valid = false;

  if (keyEntry.alg === 'ed25519') {
     valid = crypto.verify(null, hash, crypto.createPublicKey(keyEntry.key), sigBuf);
  } else if (keyEntry.alg === 'rsa-sha256') {
     valid = crypto.verify('sha256', hash, crypto.createPublicKey(keyEntry.key), sigBuf);
  } else {
    throw new Error(`Unsupported alg ${keyEntry.alg}`);
  }

  if (!valid) throw new Error('Manifest signature verification failed');
  return true;
}

module.exports = { verifyManifestSignature };
