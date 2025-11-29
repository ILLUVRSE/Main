/**
 * memory-layer/test/unit/auditChain.test.ts
 *
 * Unit tests for auditChain utilities.
 * Verifies canonicalization, digest computation, and signing.
 */

import crypto from 'node:crypto';

// Mock kmsAdapter to avoid loading AWS SDK which might be broken/missing dependencies
jest.mock('../../service/audit/kmsAdapter', () => ({
    signAuditHash: jest.fn(),
    verifySignature: jest.fn(),
}));

// Mock signingProxyClient
jest.mock('../../service/audit/signingProxyClient', () => ({
    signAuditHash: jest.fn(),
    verifySignature: jest.fn(),
}));

import auditChain from '../../service/audit/auditChain';

describe('auditChain', () => {
  describe('canonicalizePayload', () => {
    test('handles primitives', () => {
      expect(auditChain.canonicalizePayload(null)).toBe('null');
      expect(auditChain.canonicalizePayload('test')).toBe('"test"');
      expect(auditChain.canonicalizePayload(123)).toBe('123');
      expect(auditChain.canonicalizePayload(true)).toBe('true');
    });

    test('handles arrays', () => {
      expect(auditChain.canonicalizePayload([1, 2, 3])).toBe('[1,2,3]');
      expect(auditChain.canonicalizePayload(['b', 'a'])).toBe('["b","a"]'); // Arrays preserve order
    });

    test('handles objects (sorted keys)', () => {
      const input = { b: 2, a: 1 };
      // JSON.stringify always sorts keys? No, inconsistent. But sortValue DOES.
      // {"a":1,"b":2}
      expect(auditChain.canonicalizePayload(input)).toBe('{"a":1,"b":2}');
    });

    test('handles nested objects', () => {
      const input = { z: { y: 2, x: 1 }, a: [3, 2] };
      // {"a":[3,2],"z":{"x":1,"y":2}}
      expect(auditChain.canonicalizePayload(input)).toBe('{"a":[3,2],"z":{"x":1,"y":2}}');
    });

    test('matches Kernel behavior (parity check)', () => {
        // Based on shared/lib/audit.ts observation:
        // undefined values in objects are filtered out.
        const input = { a: 1, b: undefined };
        expect(auditChain.canonicalizePayload(input)).toBe('{"a":1}');

        // null values are preserved
        const input2 = { a: 1, b: null };
        expect(auditChain.canonicalizePayload(input2)).toBe('{"a":1,"b":null}');
    });
  });

  describe('computeAuditDigest', () => {
    test('computes correct SHA256 hex', () => {
      const canonical = '{"a":1}';
      const prevHash = null;
      // SHA256('{"a":1}')
      const expected = crypto.createHash('sha256').update(canonical).digest('hex');
      expect(auditChain.computeAuditDigest(canonical, prevHash)).toBe(expected);
    });

    test('chains prevHash correctly', () => {
      const canonical = '{"a":1}';
      const prevHash = '0000000000000000000000000000000000000000000000000000000000000000'; // 64 hex chars

      const buf1 = Buffer.from(canonical, 'utf8');
      const buf2 = Buffer.from(prevHash, 'hex');
      const expected = crypto.createHash('sha256').update(Buffer.concat([buf1, buf2])).digest('hex');

      expect(auditChain.computeAuditDigest(canonical, prevHash)).toBe(expected);
    });
  });

  describe('signAuditDigestSync', () => {
    beforeAll(() => {
        process.env.AUDIT_SIGNING_KEY = 'secret';
        process.env.AUDIT_SIGNING_ALG = 'hmac-sha256';
    });

    afterAll(() => {
        delete process.env.AUDIT_SIGNING_KEY;
        delete process.env.AUDIT_SIGNING_ALG;
    });

    test('signs with HMAC', () => {
        const hash = 'deadbeef';
        const sig = auditChain.signAuditDigestSync(hash);
        expect(sig).toBeTruthy();

        // Verify manually
        const expected = crypto.createHmac('sha256', 'secret')
            .update(Buffer.from(hash, 'hex'))
            .digest('base64');
        expect(sig).toBe(expected);
    });
  });

  describe('verifySignature', () => {
      beforeAll(() => {
          process.env.AUDIT_SIGNING_KEY = 'secret';
          process.env.AUDIT_SIGNING_ALG = 'hmac-sha256';
      });

      test('verifies valid HMAC signature', async () => {
          const hashHex = 'deadbeef';
          const sig = auditChain.signAuditDigestSync(hashHex);
          const digestBuf = Buffer.from(hashHex, 'hex');

          const isValid = await auditChain.verifySignature(sig!, digestBuf);
          expect(isValid).toBe(true);
      });

      test('rejects invalid signature', async () => {
        const hashHex = 'deadbeef';
        const digestBuf = Buffer.from(hashHex, 'hex');

        const isValid = await auditChain.verifySignature('bad_sig', digestBuf);
        expect(isValid).toBe(false);
      });
  });
});
