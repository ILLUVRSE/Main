// kernel/test/unit/audit_verify.test.ts
// Unit tests for kernel/tools/audit-verify.js verifier: RSA + Ed25519 flows.
//
// Run: from repo root -> cd kernel && npx jest test/unit/audit_verify.test.ts --runInBand

import * as crypto from 'crypto';
const { parseSignerRegistry, verifyEvents, canonicalize } = require('../../tools/audit-verify');

function base64(buf: Buffer | string) {
  if (Buffer.isBuffer(buf)) return buf.toString('base64');
  return Buffer.from(String(buf)).toString('base64');
}

describe('kernel audit verifier - RSA and Ed25519', () => {
  test('verifies a two-event chain signed with RSA (rsa-sha256)', () => {
    const { publicKey: rsaPubPem, privateKey: rsaPrivPem } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicExponent: 0x10001,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
    });

    const signerId = 'unit-test-rsa';
    const signerRegistry = {
      signers: [
        { signerId, algorithm: 'rsa-sha256', publicKey: rsaPubPem }
      ]
    };
    const signerMap = parseSignerRegistry(signerRegistry);

    // Event 1
    const payload1 = { id: 'e1', name: 'first' };
    const canonical1 = canonicalize(payload1); // Buffer
    const concat1 = Buffer.concat([canonical1, Buffer.alloc(0)]);
    const hashBuf1 = crypto.createHash('sha256').update(concat1).digest();
    const computedHash1 = hashBuf1.toString('hex');

    // RSA signature: verifier expects signature over message (concat) with sha256
    const sig1 = crypto.sign('sha256', concat1, { key: rsaPrivPem, padding: crypto.constants.RSA_PKCS1_PADDING });
    const row1 = {
      id: 'e1',
      event_type: 'test',
      payload: payload1,
      prev_hash: null,
      signature: base64(sig1),
      signer_kid: signerId
    };

    // Event 2
    const payload2 = { id: 'e2', name: 'second', more: { a: 1 } };
    const canonical2 = canonicalize(payload2);
    const concat2 = Buffer.concat([canonical2, Buffer.from(computedHash1, 'hex')]);
    const hashBuf2 = crypto.createHash('sha256').update(concat2).digest();
    const computedHash2 = hashBuf2.toString('hex');

    const sig2 = crypto.sign('sha256', concat2, { key: rsaPrivPem, padding: crypto.constants.RSA_PKCS1_PADDING });
    const row2 = {
      id: 'e2',
      event_type: 'test',
      payload: payload2,
      prev_hash: computedHash1,
      signature: base64(sig2),
      signer_kid: signerId
    };

    const head = verifyEvents([row1, row2], signerMap);
    expect(head).toBe(computedHash2);
  });

  test('verifies a two-event chain signed with Ed25519 (ed25519)', () => {
    const { publicKey: edPubPem, privateKey: edPrivPem } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const signerId = 'unit-test-ed25519';
    const signerRegistry = {
      signers: [
        { signerId, algorithm: 'ed25519', publicKey: edPubPem }
      ]
    };
    const signerMap = parseSignerRegistry(signerRegistry);

    // Event 1
    const payload1 = { id: 'e1', name: 'ed-first' };
    const canonical1 = canonicalize(payload1);
    const concat1 = Buffer.concat([canonical1, Buffer.alloc(0)]);
    const hashBuf1 = crypto.createHash('sha256').update(concat1).digest();
    const computedHash1 = hashBuf1.toString('hex');

    // Ed25519 signs the digest bytes
    const sig1 = crypto.sign(null, hashBuf1, edPrivPem);
    const row1 = {
      id: 'e1',
      event_type: 'test',
      payload: payload1,
      prev_hash: null,
      signature: base64(sig1),
      signer_kid: signerId
    };

    // Event 2
    const payload2 = { id: 'e2', name: 'ed-second', blob: [1, 2, 3] };
    const canonical2 = canonicalize(payload2);
    const concat2 = Buffer.concat([canonical2, Buffer.from(computedHash1, 'hex')]);
    const hashBuf2 = crypto.createHash('sha256').update(concat2).digest();
    const computedHash2 = hashBuf2.toString('hex');

    const sig2 = crypto.sign(null, hashBuf2, edPrivPem);
    const row2 = {
      id: 'e2',
      event_type: 'test',
      payload: payload2,
      prev_hash: computedHash1,
      signature: base64(sig2),
      signer_kid: signerId
    };

    const head = verifyEvents([row1, row2], signerMap);
    expect(head).toBe(computedHash2);
  });
});

