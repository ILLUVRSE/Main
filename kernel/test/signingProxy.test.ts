// kernel/test/signingProxy.test.ts
import { startMockKmsServer } from './mocks/mockKmsServer';

describe('signingProxy (KMS integration)', () => {
  // Ensure tests run with a clean module cache so env changes are picked up.
  afterEach(() => {
    // Reset module cache so require() re-reads env-configured constants.
    jest.resetModules();
    // Clean env to avoid leaking between tests
    delete process.env.KMS_ENDPOINT;
    delete process.env.REQUIRE_KMS;
    delete process.env.SIGNER_ID;
    delete process.env.KMS_BEARER_TOKEN;
    delete process.env.KMS_MTLS_CERT_PATH;
    delete process.env.KMS_MTLS_KEY_PATH;
  });

  test('signManifest uses KMS when KMS_ENDPOINT is configured (happy path)', async () => {
    const server = await startMockKmsServer();
    try {
      process.env.KMS_ENDPOINT = server.url;
      process.env.REQUIRE_KMS = 'false';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const signingProxy = require('../src/signingProxy');

      const manifest = { id: 'manifest-abc', foo: 'bar' };
      const sig = await signingProxy.signManifest(manifest);
      expect(sig).toBeDefined();
      expect(sig.signature).toBeTruthy();
      expect(sig.signerId).toBeDefined();
      // The mock returns signer_id='mock-signer' by default
      expect(sig.signerId).toBe('mock-signer');
      expect(sig.manifestId).toBe(manifest.id);
    } finally {
      await server.close();
    }
  });

  test('signData uses KMS and returns signature/signerId', async () => {
    const server = await startMockKmsServer();
    try {
      process.env.KMS_ENDPOINT = server.url;
      process.env.REQUIRE_KMS = 'false';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const signingProxy = require('../src/signingProxy');

      const res = await signingProxy.signData('hello world');
      expect(res).toBeDefined();
      expect(res.signature).toBeTruthy();
      expect(res.signerId).toBeDefined();
      expect(res.signerId).toBe('mock-signer');
    } finally {
      await server.close();
    }
  });

  test('when KMS returns error and REQUIRE_KMS=true -> signManifest throws', async () => {
    const server = await startMockKmsServer({ statusCode: 500 });
    try {
      process.env.KMS_ENDPOINT = server.url;
      process.env.REQUIRE_KMS = 'true';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const signingProxy = require('../src/signingProxy');

      await expect(signingProxy.signManifest({})).rejects.toThrow(/REQUIRE_KMS=true/);
    } finally {
      await server.close();
    }
  });

  test('when KMS returns error and REQUIRE_KMS=false -> signManifest falls back to local ephemeral signing', async () => {
    const server = await startMockKmsServer({ statusCode: 500 });
    try {
      process.env.KMS_ENDPOINT = server.url;
      process.env.REQUIRE_KMS = 'false';
      // Set a known SIGNER_ID so we can assert fallback signer id
      process.env.SIGNER_ID = 'kernel-signer-local';
      jest.resetModules();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const signingProxy = require('../src/signingProxy');

      const sig = await signingProxy.signManifest({ some: 'payload' });
      expect(sig).toBeDefined();
      expect(sig.signature).toBeTruthy();
      // fallback signerId should match SIGNER_ID env or default
      expect(sig.signerId).toBe('kernel-signer-local');
    } finally {
      await server.close();
    }
  });

  test('REQUIRE_KMS=true and missing KMS_ENDPOINT -> throws immediately', async () => {
    // Ensure no KMS_ENDPOINT set
    delete process.env.KMS_ENDPOINT;
    process.env.REQUIRE_KMS = 'true';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const signingProxy = require('../src/signingProxy');

    await expect(signingProxy.signManifest({})).rejects.toThrow(
      'REQUIRE_KMS=true but KMS_ENDPOINT is not configured'
    );
  });
});

