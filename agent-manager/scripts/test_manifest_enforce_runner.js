// agent-manager/scripts/test_manifest_enforce_runner.js
const request = require('supertest');
const crypto = require('crypto');
const app = require('../server/index');
const keyStore = require('../server/key_store');
const { canonicalize } = require('../server/audit_signer');

// Mock keyStore to return our test key
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const TEST_KID = 'test-kid';

// We mock keyStore.getKernelPublicKeys
keyStore.getKernelPublicKeys = async () => {
  return {
    [TEST_KID]: {
      alg: 'ed25519',
      key: publicKey.export({ type: 'spki', format: 'pem' })
    }
  };
};

async function runTests() {
  console.log('Running Manifest Enforcement Tests...');

  // 1. Test Valid Signature
  const manifest = {
    name: 'secure-agent',
    version: '1.0.0'
  };
  const canonicalJson = canonicalize(manifest);
  const hash = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest();
  const signature = crypto.sign(null, hash, privateKey).toString('base64');

  const res1 = await request(app)
    .post('/api/v1/agent/spawn')
    .send({
      agent_config: { name: 'secure-agent', profile: 'illuvrse' },
      signed_manifest: {
        manifest,
        signature,
        kid: TEST_KID
      }
    });

  if (res1.statusCode !== 201) {
    console.error('Failed valid signature test:', res1.body);
    process.exit(1);
  }
  console.log('Valid signature test passed.');

  // 2. Test Invalid Signature
  const invalidSig = Buffer.from('invalid').toString('base64');
  const res2 = await request(app)
    .post('/api/v1/agent/spawn')
    .send({
      agent_config: { name: 'secure-agent', profile: 'illuvrse' },
      signed_manifest: {
        manifest,
        signature: invalidSig,
        kid: TEST_KID
      }
    });

  if (res2.statusCode !== 403) {
    console.error('Failed invalid signature test. Expected 403, got:', res2.statusCode);
    process.exit(1);
  }
  console.log('Invalid signature test passed.');

  // 3. Test Unsigned (Missing Manifest)
  const res3 = await request(app)
    .post('/api/v1/agent/spawn')
    .send({
      agent_config: { name: 'secure-agent', profile: 'illuvrse' }
    });

  if (res3.statusCode !== 403) {
    console.error('Failed missing manifest test. Expected 403, got:', res3.statusCode);
    process.exit(1);
  }
  console.log('Missing manifest test passed.');

  process.exit(0);
}

runTests();
