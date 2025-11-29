/**
 * kernel/test/signingProxy.test.ts
 *
 * Unit tests for kernel/src/signingProxy.ts
 *
 * We test:
 *  - local fallback when KMS not configured
 *  - throwing when REQUIRE_KMS=true and KMS missing
 *  - using KMS provider when configured
 *
 * Tests use jest.resetModules and jest.mock to control per-test module environment.
 */

import { jest } from '@jest/globals';

jest.mock('../src/services/signatureVerifier', () => {
  const actual = jest.requireActual('../src/services/signatureVerifier') as any;
  return {
    ...actual,
    verifySignaturePayload: jest.fn(),
  };
});

describe('signingProxy', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('falls back to local provider when KMS not configured and REQUIRE_KMS=false', async () => {
    // Mock kms config to indicate no endpoint and REQUIRE_KMS=false
    jest.doMock('../src/config/kms', () => {
      const loadKmsConfig = jest.fn(() => ({
        endpoint: undefined,
        requireKms: false,
        signerId: 'local-signer',
        bearerToken: undefined,
        mtlsCertPath: undefined,
        mtlsKeyPath: undefined,
        timeoutMs: 5000,
      }));
      return {
        __esModule: true,
        default: loadKmsConfig,
        loadKmsConfig,
      };
    });

    // Mock LocalSigningProvider implementation so signManifest returns deterministic result
    const localSignManifest = jest.fn(async (manifest: any, req: any) => {
      return {
        id: `local-sig-${manifest?.id ?? 'noid'}`,
        manifestId: manifest?.id ?? null,
        signerId: 'local-signer',
        signature: 'local-signature',
        version: manifest?.version ?? '1.0.0',
        ts: new Date().toISOString(),
        prevHash: null,
      };
    });

    const localSignData = jest.fn(async (data: string, _req?: any) => {
      return { signature: 'local-data-sig', signerId: 'local-signer' };
    });

    jest.doMock('../src/signingProvider', () => {
      class LocalSigningProvider {
        constructor(public signerId: string) {}
        async signManifest(manifest: any, _req: any) {
          return localSignManifest(manifest, _req);
        }
        async signData(data: string, _req: any) {
          return localSignData(data, _req);
        }
        async getPublicKey() {
          return Buffer.from('mock-public-key').toString('base64');
        }
      }
      return {
        __esModule: true,
        LocalSigningProvider,
        createSigningProvider: jest.fn(),
        prepareManifestSigningRequest: jest.fn((m: any) => ({})),
        prepareDataSigningRequest: jest.fn((d: any) => ({})),
      };
    });

    // Import signingProxy after mocks
    const signingProxy = (await import('../src/signingProxy')).default;

    const manifest = { id: 'division-xyz', name: 'X' };
    const sig = await signingProxy.signManifest(manifest);
    expect(sig).toBeDefined();
    expect(sig.manifestId).toBe(manifest.id);
    expect(sig.signerId).toBe('local-signer');
    expect(localSignManifest).toHaveBeenCalledTimes(1);

    const dataRes = await signingProxy.signData('hello');
    expect(dataRes.signature).toBe('local-data-sig');
    expect(localSignData).toHaveBeenCalledTimes(1);
  });

  test('throws when REQUIRE_KMS=true and KMS_ENDPOINT missing', async () => {
    jest.doMock('../src/config/kms', () => {
      const loadKmsConfig = jest.fn(() => ({
        endpoint: undefined,
        requireKms: true,
        signerId: 'local-signer',
        bearerToken: undefined,
        mtlsCertPath: undefined,
        mtlsKeyPath: undefined,
        timeoutMs: 5000,
      }));
      return {
        __esModule: true,
        default: loadKmsConfig,
        loadKmsConfig,
      };
    });

    // Provide basic signingProvider mock (should not be used)
    jest.doMock('../src/signingProvider', () => {
      class LocalSigningProvider {
        async signManifest() {
          return {};
        }
        async signData() {
          return { signature: 'x', signerId: 'x' };
        }
        async getPublicKey() {
          return Buffer.from('mock-key').toString('base64');
        }
      }
      return {
        __esModule: true,
        LocalSigningProvider,
        createSigningProvider: jest.fn(),
        prepareManifestSigningRequest: jest.fn(),
        prepareDataSigningRequest: jest.fn(),
      };
    });

    const signingProxyMod = await import('../src/signingProxy');

    await expect(signingProxyMod.signManifest({ id: 'x' })).rejects.toThrow(/REQUIRE_KMS=true/);
    await expect(signingProxyMod.signData('abc')).rejects.toThrow(/REQUIRE_KMS=true/);
  });

  test('uses KMS provider when configured', async () => {
    jest.doMock('../src/config/kms', () => {
      const loadKmsConfig = jest.fn(() => ({
        endpoint: 'http://kms.local',
        requireKms: false,
        signerId: 'kms-signer',
        bearerToken: undefined,
        mtlsCertPath: undefined,
        mtlsKeyPath: undefined,
        timeoutMs: 5000,
      }));
      return {
        __esModule: true,
        default: loadKmsConfig,
        loadKmsConfig,
      };
    });

    const kmsSignManifest = jest.fn(async (manifest: any) => {
      return {
        id: `kms-sig-${manifest?.id ?? 'noid'}`,
        manifestId: manifest?.id ?? null,
        signerId: 'kms-signer',
        signature: 'kms-signature',
        version: manifest?.version ?? '1.0.0',
        ts: new Date().toISOString(),
        prevHash: null,
      };
    });
    const kmsSignData = jest.fn(async (data: string) => ({ signature: 'kms-data-sig', signerId: 'kms-signer' }));

    // Mock createSigningProvider to return an object with signManifest/signData
    jest.doMock('../src/signingProvider', () => {
      return {
        __esModule: true,
        createSigningProvider: jest.fn(() => ({
          signManifest: kmsSignManifest,
          signData: kmsSignData,
          getPublicKey: jest.fn(async () => Buffer.from('kms-key').toString('base64')),
        })),
        LocalSigningProvider: jest.fn(),
        prepareManifestSigningRequest: jest.fn((m: any) => ({})),
        prepareDataSigningRequest: jest.fn((d: any) => ({})),
      };
    });

    const signingProxy = (await import('../src/signingProxy')).default;

    const manifest = { id: 'div-kms' };
    const sig = await signingProxy.signManifest(manifest);
    expect(sig.signerId).toBe('kms-signer');
    expect(kmsSignManifest).toHaveBeenCalledTimes(1);

    const d = await signingProxy.signData('payload');
    expect(d.signature).toBe('kms-data-sig');
    expect(kmsSignData).toHaveBeenCalledTimes(1);
  });
});
