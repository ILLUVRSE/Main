// agent-manager/test/audit_signer.test.js
//
// Unit test for digest signing: compute canonical(payload) || prevHashBytes,
// SHA256 that, call signAuditHash(hash) and verify the signature with the public key.
//
// This test assumes a test runner like Jest (describe/it/expect).
// If running directly with node, you can wrap the async test in an IIFE.

const crypto = require('crypto');

const { signAuditHash } = require('../server/signAuditHash');
const { canonicalize } = require('../server/audit_signer');

describe('audit_signer digest signing (signAuditHash)', () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    // restore env after each test to avoid cross-test pollution
    process.env = { ...OLD_ENV };
  });

  it('computes the correct SHA256(canonical(payload) || prevHashBytes) and RSA-verifies the signature', async () => {
    // 1) generate an RSA keypair (2048 bits) for test
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicExponent: 0x10001,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
    });

    // 2) configure env so signAuditHash uses local env key
    process.env.AUDIT_SIGNING_KEY_SOURCE = 'env';
    process.env.AUDIT_SIGNING_PRIVATE_KEY = privateKey;
    process.env.AUDIT_SIGNING_ALG = 'rsa-sha256';
    process.env.AUDIT_SIGNER_KID = 'unit-test-rsa';

    // 3) prepare payload and prev_hash
    const payload = {
      id: 'payload-123',
      name: 'unit test',
      nested: { a: 1, b: [2, 3] },
      flag: true,
    };

    // simulate previous hash (32-byte hex)
    const prevHashHex = crypto.createHash('sha256').update('previous-event').digest('hex');
    const prevHashBytes = Buffer.from(prevHashHex, 'hex');

    // 4) canonicalize payload (string)
    const canonicalPayload = canonicalize(payload);
    const canonicalBuf = Buffer.from(canonicalPayload, 'utf8');

    // 5) compute the digest = SHA256(canonical(payload) || prevHashBytes)
    const concat = Buffer.concat([canonicalBuf, prevHashBytes]);
    const hashBuf = crypto.createHash('sha256').update(concat).digest();

    // 6) call signAuditHash(hashBuf)
    const signed = await signAuditHash(hashBuf);

    expect(signed).toBeDefined();
    expect(signed.signature).toBeDefined();
    expect(typeof signed.signature).toBe('string');
    expect(signed.kid).toBe('unit-test-rsa');
    expect(signed.alg).toMatch(/rsa/i);

    // 7) verify signature with public key
    const signatureBuf = Buffer.from(signed.signature, 'base64');

    // Verify by re-hashing the original message (crypto.verify will hash automatically)
    const verified = crypto.verify(
      'sha256',
      concat, // the original message whose digest was signed
      publicKey,
      signatureBuf
    );

    expect(verified).toBe(true);
  });
});

