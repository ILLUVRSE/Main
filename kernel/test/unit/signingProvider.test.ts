import { FakeKmsSigningProvider, LocalSigningProvider, prepareManifestSigningRequest } from '../../src/signingProvider';

describe('signingProvider abstraction', () => {
  describe('LocalSigningProvider', () => {
    it('signs manifests with an in-memory key and exposes the public key', async () => {
      const provider = new LocalSigningProvider('unit-test-signer');
      const manifest = { id: 'manifest-123', version: '1.2.3', payload: { foo: 'bar' } };
      const signature = await provider.signManifest(manifest);

      expect(signature.signerId).toBe('unit-test-signer');
      expect(signature.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(signature.manifestId).toBe('manifest-123');
      expect(signature.algorithm).toBe('ed25519');
      expect(signature.keyVersion).toBe('local-dev');

      const publicKey = await provider.getPublicKey();
      expect(publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(publicKey.length).toBeGreaterThan(32);
    });

    it('reuses the same key material for the same signer id', async () => {
      const firstProvider = new LocalSigningProvider('shared-signer');
      const secondProvider = new LocalSigningProvider('shared-signer');

      const firstKey = await firstProvider.getPublicKey();
      const secondKey = await secondProvider.getPublicKey();

      expect(firstKey).toBe(secondKey);
    });
  });

  describe('FakeKmsSigningProvider', () => {
    it('returns deterministic responses useful for unit tests', async () => {
      const fake = new FakeKmsSigningProvider({
        signerId: 'kms-test',
        signature: 'ZmFrZS1zaWduYXR1cmU=',
        publicKey: 'ZmFrZS1wdWJsaWMta2V5',
        manifestId: 'fake-manifest',
        ts: '2024-01-01T00:00:00.000Z',
        version: '9.9.9',
      });

      const manifest = { id: 'ignored', version: '1.0.0' };
      const request = prepareManifestSigningRequest(manifest);
      const signature = await fake.signManifest(manifest, request);

      expect(signature.signerId).toBe('kms-test');
      expect(signature.signature).toBe('ZmFrZS1zaWduYXR1cmU=');
      expect(signature.manifestId).toBe('fake-manifest');
      expect(signature.version).toBe('9.9.9');
      expect(signature.algorithm).toBe('ed25519');
      expect(signature.keyVersion).toBeUndefined();
      expect(signature.ts).toBe('2024-01-01T00:00:00.000Z');

      const publicKey = await fake.getPublicKey('kms-test');
      expect(publicKey).toBe('ZmFrZS1wdWJsaWMta2V5');
    });
  });
});
