// agent-manager/test/kms_adapter.test.js
//
// Unit tests for KMS adapter signing paths (message vs digest) and local fallback.
// Uses jest to mock @aws-sdk/client-kms and inspects the Sign/GenerateMac command params.
//
// These tests assume a Jest test runner.

const crypto = require('crypto');

const SHA256_DIGESTINFO_PREFIX_HEX = '3031300d060960864801650304020105000420';
const SHA256_DIGESTINFO_PREFIX = Buffer.from(SHA256_DIGESTINFO_PREFIX_HEX, 'hex');

describe('KMS adapter and digest signing behavior', () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
    jest.resetModules();
    jest.clearAllMocks();
  });

  function makeKmsMock() {
    class SignCommand {
      constructor(params) {
        this.params = params;
      }
    }
    class GenerateMacCommand {
      constructor(params) {
        this.params = params;
      }
    }
    class GetPublicKeyCommand {
      constructor(params) {
        this.params = params;
      }
    }
    class KMSClient {
      constructor(opts) {
        // record the last constructed client/options
        KMSClient.lastClient = this;
        this.opts = opts;
      }

      async send(cmd) {
        // record the last command for the test to inspect
        KMSClient.lastCmd = cmd;

        // Mock responses depending on command type
        if (cmd instanceof GenerateMacCommand) {
          return { Mac: Buffer.from('mock-mac-by-kms') };
        }
        if (cmd instanceof SignCommand) {
          // If MessageType === 'DIGEST' return a "digest signature" marker,
          // otherwise return a "message signature" marker.
          return { Signature: Buffer.from(cmd.params && cmd.params.MessageType === 'DIGEST' ? 'signed-digest-by-kms' : 'signed-message-by-kms') };
        }
        if (cmd instanceof GetPublicKeyCommand) {
          return {
            // Return a minimal object with SigningAlgorithms & KeySpec to enable inference
            SigningAlgorithms: ['RSASSA_PKCS1_V1_5_SHA_256'],
            KeySpec: 'RSA_2048'
          };
        }
        return {};
      }
    }

    return {
      KMSClient,
      SignCommand,
      GenerateMacCommand,
      GetPublicKeyCommand
    };
  }

  it('key_store_kms_adapter.signAuditCanonical uses SignCommand with message (no MessageType)', async () => {
    jest.doMock('@aws-sdk/client-kms', () => makeKmsMock());

    // Ensure adapter picks KMS path
    process.env.AUDIT_SIGNING_KMS_KEY_ID = 'test-kms-key';
    process.env.AUDIT_SIGNING_ALG = 'rsa-sha256';
    process.env.AWS_REGION = 'us-east-1';

    // load adapter (it will use the mocked aws sdk)
    const adapter = require('../server/key_store_kms_adapter');

    const canonical = 'canonical-string-abc';
    const res = await adapter.signAuditCanonical(canonical);

    // Grab the mocked KMS classes used by the module
    const kmsMock = require('@aws-sdk/client-kms');
    const KMSClient = kmsMock.KMSClient;
    const SignCommand = kmsMock.SignCommand;

    expect(KMSClient.lastCmd).toBeInstanceOf(SignCommand);
    // SigningAlgorithm for RSA
    expect(KMSClient.lastCmd.params.SigningAlgorithm).toBe('RSASSA_PKCS1_V1_5_SHA_256');
    // Message should equal the canonical buffer
    expect(Buffer.isBuffer(KMSClient.lastCmd.params.Message)).toBe(true);
    expect(Buffer.compare(KMSClient.lastCmd.params.Message, Buffer.from(canonical))).toBe(0);
    // The adapter returns base64 of the signature buffer
    expect(res.signature).toBe(Buffer.from('signed-message-by-kms').toString('base64'));
    expect(res.kid).toBe(process.env.AUDIT_SIGNING_KMS_KEY_ID);
    expect(res.alg).toBe('rsa-sha256');
  });

  it('signAuditHash calls KMS Sign with MessageType: "DIGEST" when using KMS for RSA digest signing', async () => {
    jest.doMock('@aws-sdk/client-kms', () => makeKmsMock());

    // Force key_store.getAuditSigningKey to pick KMS path via env
    process.env.AUDIT_SIGNING_KEY_SOURCE = 'kms';
    process.env.AUDIT_SIGNING_KMS_KEY_ID = 'digest-kms-key';
    process.env.AUDIT_SIGNING_ALG = 'rsa-sha256';
    process.env.AWS_REGION = 'us-east-1';

    // Reload fresh modules
    jest.resetModules();

    const { signAuditHash } = require('../server/signAuditHash');

    // prepare a 32-byte digest to sign
    const hashBuf = crypto.createHash('sha256').update('some canonical and prev').digest();

    const signed = await signAuditHash(hashBuf);

    // Inspect KMS mock
    const kmsMock = require('@aws-sdk/client-kms');
    const KMSClient = kmsMock.KMSClient;
    const SignCommand = kmsMock.SignCommand;

    expect(KMSClient.lastCmd).toBeInstanceOf(SignCommand);
    // Should set MessageType to DIGEST when signing a precomputed digest
    expect(KMSClient.lastCmd.params.MessageType).toBe('DIGEST');
    expect(Buffer.compare(KMSClient.lastCmd.params.Message, hashBuf)).toBe(0);
    expect(KMSClient.lastCmd.params.SigningAlgorithm).toBe('RSASSA_PKCS1_V1_5_SHA_256');

    expect(signed).toBeDefined();
    expect(signed.signature).toBe(Buffer.from('signed-digest-by-kms').toString('base64'));
    expect(signed.kid).toBe(process.env.AUDIT_SIGNING_KMS_KEY_ID || process.env.AUDIT_SIGNING_KMS_KEY_ID);
  });

  it('signAuditHash falls back to local RSA key when AUDIT_SIGNING_KEY_SOURCE=env and produces verifiable signature', async () => {
    // No KMS mocking here — local signing path should be used.
    jest.resetModules();

    // generate RSA keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicExponent: 0x10001,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
    });

    process.env.AUDIT_SIGNING_KEY_SOURCE = 'env';
    process.env.AUDIT_SIGNING_PRIVATE_KEY = privateKey;
    process.env.AUDIT_SIGNING_ALG = 'rsa-sha256';
    process.env.AUDIT_SIGNER_KID = 'local-rsa-test';

    const { signAuditHash } = require('../server/signAuditHash');

    const hashBuf = crypto.createHash('sha256').update('canonical+prev').digest();

    const signed = await signAuditHash(hashBuf);

    expect(signed).toBeDefined();
    expect(typeof signed.signature).toBe('string');

    // Verify signature by performing publicDecrypt and checking DigestInfo || hash
    const signatureBuf = Buffer.from(signed.signature, 'base64');

    const decrypted = crypto.publicDecrypt(
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      signatureBuf
    );

    const expected = Buffer.concat([SHA256_DIGESTINFO_PREFIX, hashBuf]);
    expect(Buffer.compare(decrypted, expected)).toBe(0);
    expect(signed.kid).toBe('local-rsa-test');
    expect(signed.alg).toBe('rsa-sha256');
  });

  it('signAuditHash uses KMS GenerateMac for HMAC keys', async () => {
    jest.doMock('@aws-sdk/client-kms', () => makeKmsMock());

    process.env.AUDIT_SIGNING_KEY_SOURCE = 'kms';
    process.env.AUDIT_SIGNING_KMS_KEY_ID = 'hmac-kms-key';
    process.env.AUDIT_SIGNING_ALG = 'hmac-sha256';
    process.env.AWS_REGION = 'us-east-1';

    jest.resetModules();
    const { signAuditHash } = require('../server/signAuditHash');

    const hashBuf = crypto.createHash('sha256').update('some canonical').digest();
    const signed = await signAuditHash(hashBuf);

    const kmsMock = require('@aws-sdk/client-kms');
    const KMSClient = kmsMock.KMSClient;
    const GenerateMacCommand = kmsMock.GenerateMacCommand;

    expect(KMSClient.lastCmd).toBeInstanceOf(GenerateMacCommand);
    // For HMAC path we pass the digest bytes to GenerateMac
    expect(Buffer.compare(KMSClient.lastCmd.params.Message, hashBuf)).toBe(0);
    expect(signed.alg).toBe('hmac-sha256');
    expect(signed.signature).toBe(Buffer.from('mock-mac-by-kms').toString('base64'));
  });
});

