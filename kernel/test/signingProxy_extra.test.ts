// test/signingProxy_extra.test.ts
import { jest } from '@jest/globals';

describe('signingProxy - extra branches', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('kms signManifest throws -> fallback to local when REQUIRE_KMS=false', async () => {
    // kms config: endpoint present, requireKms = false
    jest.doMock('../src/config/kms', () => {
      const loadKmsConfig = jest.fn(() => ({
        endpoint: 'http://kms.local',
        requireKms: false,
        signerId: 'local-signer',
        bearerToken: undefined,
        mtlsCertPath: undefined,
        mtlsKeyPath: undefined,
        timeoutMs: 5000,
      }));
      return { __esModule: true, default: loadKmsConfig, loadKmsConfig };
    });

    // createSigningProvider returns a provider whose signManifest throws
    const kmsSignManifest = jest.fn(async () => { throw new Error('kms-boom'); });
    jest.doMock('../src/signingProvider', () => {
      class LocalSigningProvider {
        constructor(public signerId: string) {}
        async signManifest(m: any) { return { id: `local-${m.id}`, manifestId: m.id, signerId: this.signerId, signature: 'local', version: '1.0.0', ts: new Date().toISOString(), prevHash: null }; }
        async signData() { return { signature: 'local-sig', signerId: this.signerId }; }
      }
      return {
        __esModule: true,
        createSigningProvider: jest.fn(() => ({ signManifest: kmsSignManifest })),
        LocalSigningProvider,
        prepareManifestSigningRequest: jest.fn((m: any) => ({})),
        prepareDataSigningRequest: jest.fn((d: any) => ({})),
      };
    });

    const signingProxy = (await import('../src/signingProxy')).default;
    const manifest = { id: 'm1' };

    // should not throw, should fallback to local provider
    const sig = await signingProxy.signManifest(manifest);
    expect(sig).toBeDefined();
    expect(sig.manifestId).toBe(manifest.id);
    expect(kmsSignManifest).toHaveBeenCalledTimes(1);
  });

  test('kms signManifest throws -> throw when REQUIRE_KMS=true', async () => {
    jest.doMock('../src/config/kms', () => {
      const loadKmsConfig = jest.fn(() => ({
        endpoint: 'http://kms.local',
        requireKms: true,
        signerId: 'local-signer',
        bearerToken: undefined,
        mtlsCertPath: undefined,
        mtlsKeyPath: undefined,
        timeoutMs: 5000,
      }));
      return { __esModule: true, default: loadKmsConfig, loadKmsConfig };
    });

    const kmsSignManifest = jest.fn(async () => { throw new Error('kms-fatal'); });
    jest.doMock('../src/signingProvider', () => ({
      __esModule: true,
      createSigningProvider: jest.fn(() => ({ signManifest: kmsSignManifest })),
      LocalSigningProvider: jest.fn(),
      prepareManifestSigningRequest: jest.fn(() => ({})),
      prepareDataSigningRequest: jest.fn(() => ({})),
    }));

    const signingProxyMod = await import('../src/signingProxy');

    await expect(signingProxyMod.signManifest({ id: 'x' })).rejects.toThrow(/KMS signing failed and REQUIRE_KMS=true/);
    expect(kmsSignManifest).toHaveBeenCalledTimes(1);
  });

  test('kms provider missing signData -> throw then fallback/throw depending on REQUIRE_KMS', async () => {
    // Case A: requireKms = false -> fallback to local
    jest.doMock('../src/config/kms', () => {
      const loadKmsConfig = jest.fn(() => ({
        endpoint: 'http://kms.local',
        requireKms: false,
        signerId: 'local-signer',
        bearerToken: undefined,
        mtlsCertPath: undefined,
        mtlsKeyPath: undefined,
        timeoutMs: 5000,
      }));
      return { __esModule: true, default: loadKmsConfig, loadKmsConfig };
    });

    // provider that lacks signData
    const kmsSignDataMissingProvider = { signManifest: jest.fn(async () => ({ id: 'ok' })) };
    jest.doMock('../src/signingProvider', () => {
      class LocalSigningProvider {
        constructor(public signerId: string) {}
        async signManifest() { return { id: 'local' }; }
        async signData(d: string) { return { signature: 'local-data-sig', signerId: this.signerId }; }
      }
      return {
        __esModule: true,
        createSigningProvider: jest.fn(() => kmsSignDataMissingProvider),
        LocalSigningProvider,
        prepareManifestSigningRequest: jest.fn(() => ({})),
        prepareDataSigningRequest: jest.fn(() => ({})),
      };
    });

    let signingProxy = (await import('../src/signingProxy')).default;
    const data = 'hello';

    // Because provider.signData is missing, it throws; since REQUIRE_KMS=false we fallback to local
    const dres = await signingProxy.signData(data);
    expect(dres.signature).toBe('local-data-sig');

    // Reset modules for Case B
    jest.resetModules();
    jest.clearAllMocks();

    // Case B: requireKms = true -> we should bubble the error
    jest.doMock('../src/config/kms', () => {
      const loadKmsConfig = jest.fn(() => ({
        endpoint: 'http://kms.local',
        requireKms: true,
        signerId: 'local-signer',
        bearerToken: undefined,
        mtlsCertPath: undefined,
        mtlsKeyPath: undefined,
        timeoutMs: 5000,
      }));
      return { __esModule: true, default: loadKmsConfig, loadKmsConfig };
    });

    // same provider without signData
    jest.doMock('../src/signingProvider', () => {
      class LocalSigningProvider {
        constructor(public signerId: string) {}
        async signManifest() { return { id: 'local' }; }
        async signData() { return { signature: 'local-data-sig', signerId: this.signerId }; }
      }
      return {
        __esModule: true,
        createSigningProvider: jest.fn(() => kmsSignDataMissingProvider),
        LocalSigningProvider,
        prepareManifestSigningRequest: jest.fn(() => ({})),
        prepareDataSigningRequest: jest.fn(() => ({})),
      };
    });

    const signingProxyMod = await import('../src/signingProxy');
    await expect(signingProxyMod.signData('x')).rejects.toThrow(/KMS signData failed and REQUIRE_KMS=true/);
  });
});

