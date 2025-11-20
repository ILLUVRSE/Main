#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  if (!key.startsWith('--')) continue;
  const value = args[i + 1];
  options[key.replace(/^--/, '')] = value;
  i += 1;
}

if (!options.proof || !options['public-key']) {
  console.error('Usage: node finance/tools/verify_proof.js --proof <file> --public-key <pem> [--alg rsa-sha256|ed25519] [--rows <ledger_rows.jsonl>]');
  process.exit(2);
}

const proofPath = path.resolve(options.proof);
const publicKeyPath = path.resolve(options['public-key']);

const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
const publicKey = fs.readFileSync(publicKeyPath, 'utf8');

const signatureB64 = proof.signature || proof.signature_b64;
if (!signatureB64) {
  console.error('Proof is missing signature field (expected signature or signature_b64).');
  process.exit(2);
}
const signature = Buffer.from(signatureB64, 'base64');

const normalizeAlg = (val) => (val || '').toLowerCase();
const detectedAlg = normalizeAlg(options.alg || proof.alg || proof.algorithm);
let algorithm = detectedAlg;
if (!algorithm) {
  const kid = (proof.signer_kid || '').toLowerCase();
  algorithm = kid.includes('ed25519') ? 'ed25519' : 'rsa-sha256';
}

const derivePayload = () => {
  if (options.rows) {
    const rowsPath = path.resolve(options.rows);
    return { buffer: fs.readFileSync(rowsPath), isDigest: false, label: `rows:${rowsPath}` };
  }
  if (proof.canonical_message) {
    return { buffer: Buffer.from(proof.canonical_message, 'utf8'), isDigest: false, label: 'proof.canonical_message' };
  }
  if (proof.hash) {
    const hex = proof.hash.startsWith('0x') ? proof.hash.slice(2) : proof.hash;
    if (hex.length % 2 !== 0) {
      throw new Error('proof.hash must contain an even number of hex characters.');
    }
    return { buffer: Buffer.from(hex, 'hex'), isDigest: true, label: 'proof.hash' };
  }
  throw new Error('Unable to derive payload. Provide --rows <file> or include canonical_message/hash fields in the proof.');
};

const { buffer: payload, isDigest, label } = derivePayload();

const verifyRsaDigest = () => {
  const decrypted = crypto.publicDecrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, signature);
  const sha256Prefix = Buffer.from('3031300d060960864801650304020105000420', 'hex');
  const idx = decrypted.indexOf(sha256Prefix);
  if (idx === -1) {
    throw new Error('Unable to parse SHA-256 DigestInfo from RSA signature.');
  }
  const digestFromSig = decrypted.slice(idx + sha256Prefix.length, idx + sha256Prefix.length + payload.length);
  if (digestFromSig.equals(payload)) return true;
  // Some providers zero-pad the digest inside the block; compare trailing bytes as a fallback.
  return digestFromSig.slice(-payload.length).equals(payload);
};

const verify = () => {
  if (algorithm === 'ed25519') {
    const ok = crypto.verify(null, payload, publicKey, signature);
    if (!ok) {
      throw new Error('Ed25519 verification failed.');
    }
    return 'Ed25519';
  }
  if (algorithm === 'rsa-sha256') {
    if (isDigest) {
      if (!verifyRsaDigest()) {
        throw new Error('RSA digest verification failed.');
      }
      return 'RSA-SHA256 (digest)';
    }
    const ok = crypto.verify('sha256', payload, { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, signature);
    if (!ok) {
      throw new Error('RSA-SHA256 verification failed.');
    }
    return 'RSA-SHA256';
  }
  throw new Error(`Unsupported algorithm: ${algorithm}`);
};

try {
  const mode = verify();
  console.log(`[verify_proof] Signature valid (${mode}) for payload derived from ${label}.`);
  process.exit(0);
} catch (err) {
  console.error(`[verify_proof] Verification failed: ${err.message}`);
  process.exit(1);
}
