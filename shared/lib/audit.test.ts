import { canonicalize, sha256Hex, signHash } from './audit';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  Object.keys(process.env).forEach((key) => {
    delete process.env[key];
  });
  Object.assign(process.env, ORIGINAL_ENV);
  jest.restoreAllMocks();
});

describe('canonicalize', () => {
  test('sorts object keys and normalizes nested structures', () => {
    const input = {
      b: 1,
      a: {
        z: 'last',
        m: ['x', { c: 3, a: 1 }]
      }
    };
    const output = canonicalize(input);
    expect(output).toBe('{"a":{"m":["x",{"a":1,"c":3}],"z":"last"},"b":1}');
  });
});

describe('sha256Hex', () => {
  test('computes deterministic sha256 hex digest', () => {
    const digest = sha256Hex('hello-world');
    expect(digest).toBe('afa27b44d43b02a9fea41d13cedc2e4016cfcf87c5dbf990e593669aa8ce286d');
  });
});

describe('signHash', () => {
  test('falls back to deterministic dev signature when no backend configured', async () => {
    delete process.env.SIGNING_PROXY_URL;
    delete process.env.KMS_KEY_ID;
    process.env.NODE_ENV = 'test';
    const hash = 'a'.repeat(64);
    const res = await signHash(hash);
    expect(res.signer_kid).toBe('dev-signer-v1');
    expect(typeof res.signatureBase64).toBe('string');
    expect(res.signatureBase64.length).toBeGreaterThan(10);
  });
});
