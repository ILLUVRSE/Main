#!/usr/bin/env node

process.env.TS_NODE_TRANSPILE_ONLY = 'true';
require('ts-node/register');

const crypto = require('crypto');
const fetch = require('node-fetch');
const { appendAuditEvent } = require('../src/auditStore');
const { loadKmsConfig } = require('../src/config/kms');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.split('=');
      args[key.replace(/^--/, '')] = value || argv[i + 1];
      if (!value) i += 1;
    }
  }
  return args;
}

async function rotateViaKms(endpoint, signerId) {
  const url = `${endpoint.replace(/\/$/, '')}/keys/rotate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signerId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KMS rotation failed (${res.status}): ${text || res.statusText}`);
  }
  const payload = await res.json();
  if (!payload || !payload.publicKey) {
    throw new Error('KMS rotation response missing publicKey');
  }
  return {
    provider: 'kms',
    publicKey: payload.publicKey,
    keyId: payload.keyId || payload.id || null,
  };
}

function rotateLocally() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  return {
    provider: 'local',
    publicKey: pub,
    privateKey: priv,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const kmsConfig = loadKmsConfig();
  const signerId = args['signer-id'] || kmsConfig.signerId;

  if (!signerId) {
    throw new Error('Signer ID is required. Pass via --signer-id or SIGNER_ID env.');
  }

  let result;
  if (kmsConfig.endpoint) {
    console.log(`[rotate_keys] rotating signer ${signerId} via KMS ${kmsConfig.endpoint}`);
    result = await rotateViaKms(kmsConfig.endpoint, signerId);
  } else {
    console.log(`[rotate_keys] no KMS endpoint configured, generating local fallback key for ${signerId}`);
    result = rotateLocally();
    console.log('[rotate_keys] new private key (base64, keep secure):');
    console.log(result.privateKey);
  }

  await appendAuditEvent('signer.rotation', {
    signerId,
    provider: result.provider,
    publicKey: result.publicKey,
    keyId: result.keyId || null,
    rotatedAt: new Date().toISOString(),
  });

  console.log(`[rotate_keys] rotation recorded for ${signerId}.`);
}

main().catch((err) => {
  console.error('[rotate_keys] failed:', err.message || err);
  process.exit(1);
});

