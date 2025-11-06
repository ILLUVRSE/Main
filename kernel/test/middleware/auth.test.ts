import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Request } from 'express';
import { authenticateRequest, resetAuthCaches, AuthError } from '../../src/middleware/auth';

describe('auth middleware', () => {
  let privateKey: any;
  let publicJwk: any;
  const issuer = 'https://issuer.example.com';
  const audience = 'kernel-api';

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    publicJwk.kid = 'test-key';
  });

  beforeEach(() => {
    process.env.KERNEL_OIDC_CONFIG_JSON = JSON.stringify({
      issuer,
      audience,
      jwks: { keys: [publicJwk] },
    });
    delete process.env.SERVICE_ROLE_MAP;
    delete process.env.KERNEL_ALLOW_INSECURE_MTLS;
    resetAuthCaches();
  });

  afterEach(() => {
    delete process.env.KERNEL_OIDC_CONFIG_JSON;
    resetAuthCaches();
  });

  async function signToken(roles: string[]): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      roles,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('user-123')
      .sign(privateKey);
  }

  function createRequest(headers: Record<string, string> = {}): Request {
    return {
      headers,
      method: 'GET',
      path: '/test',
    } as unknown as Request;
  }

  test('authenticates valid bearer token', async () => {
    const token = await signToken(['Operator']);
    const req = createRequest({ Authorization: `Bearer ${token}` });

    const principal = await authenticateRequest(req);
    expect(principal).toBeDefined();
    expect(principal.id).toBe('user-123');
    expect(principal.roles).toEqual(expect.arrayContaining(['Operator']));
    expect(principal.source).toBe('oidc');
  });

  test('rejects invalid token', async () => {
    const req = createRequest({ Authorization: 'Bearer invalid' });
    await expect(authenticateRequest(req)).rejects.toBeInstanceOf(AuthError);
  });

  test('authenticates mTLS certificate with role mapping', async () => {
    process.env.SERVICE_ROLE_MAP = JSON.stringify({ 'svc.kernel': ['Operator'] });
    const req = {
      headers: {},
      method: 'GET',
      path: '/mtls',
      socket: {
        authorized: true,
        getPeerCertificate: () => ({ subject: { CN: 'svc.kernel' }, fingerprint256: 'abc' }),
      },
    } as unknown as Request;

    const principal = await authenticateRequest(req);
    expect(principal.type).toBe('service');
    expect(principal.roles).toEqual(expect.arrayContaining(['Operator']));
    expect(principal.id).toBe('svc.kernel');
  });

  test('throws when no auth present', async () => {
    const req = createRequest();
    await expect(authenticateRequest(req)).rejects.toBeInstanceOf(AuthError);
  });
});
