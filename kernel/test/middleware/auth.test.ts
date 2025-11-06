import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Request } from 'express';
import { authenticateRequest, resetAuthCaches, AuthError } from '../../src/middleware/auth';
import { logger } from '../../src/logger';

describe('auth middleware', () => {
  let privateKey: any;
  let publicJwk: any;
  const issuer = 'https://issuer.example.com';
  const audience = 'kernel-api';
  const originalNodeEnv = process.env.NODE_ENV;
  let auditSpy: jest.SpyInstance;

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
    process.env.NODE_ENV = 'test';
    auditSpy = jest.spyOn(logger, 'audit').mockImplementation(() => {});
    resetAuthCaches();
  });

  afterEach(() => {
    delete process.env.KERNEL_OIDC_CONFIG_JSON;
    auditSpy.mockRestore();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
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
    process.env.NODE_ENV = 'production';
    const req = {
      headers: {},
      method: 'GET',
      path: '/mtls',
      socket: {
        encrypted: true,
        authorized: true,
        getPeerCertificate: () => ({ subject: { CN: 'svc.kernel' }, fingerprint256: 'abc' }),
      },
    } as unknown as Request;

    const principal = await authenticateRequest(req);
    expect(principal.type).toBe('service');
    expect(principal.roles).toEqual(expect.arrayContaining(['Operator']));
    expect(principal.id).toBe('svc.kernel');
    expect(principal.source).toBe('mtls');
    expect(auditSpy).toHaveBeenCalledWith('auth.mtls.success', expect.objectContaining({ subject: 'svc.kernel' }));
  });

  test('rejects unauthorized mTLS certificate', async () => {
    process.env.NODE_ENV = 'production';
    const req = {
      headers: {},
      method: 'GET',
      path: '/mtls',
      socket: {
        encrypted: true,
        authorized: false,
        authorizationError: 'SELF_SIGNED_CERT_IN_CHAIN',
        getPeerCertificate: () => ({ subject: { CN: 'svc.kernel' }, fingerprint256: 'zzz' }),
      },
    } as unknown as Request;

    await expect(authenticateRequest(req)).rejects.toMatchObject({ code: 'mtls.unauthorized' });
    expect(auditSpy).toHaveBeenCalledWith(
      'auth.mtls.failure',
      expect.objectContaining({ reason: 'SELF_SIGNED_CERT_IN_CHAIN' }),
    );
  });

  test('accepts local dev principal header when not production', async () => {
    process.env.NODE_ENV = 'development';
    const req = createRequest({ 'x-local-dev-principal': 'id=svc.dev;roles=Operator,AUDitor;type=service' });

    const principal = await authenticateRequest(req);
    expect(principal.id).toBe('svc.dev');
    expect(principal.type).toBe('service');
    expect(principal.roles).toEqual(['Operator', 'AUDitor']);
    expect(principal.source).toBe('dev');
    expect(auditSpy).toHaveBeenCalledWith(
      'auth.dev.success',
      expect.objectContaining({ subject: 'svc.dev', roles: ['Operator', 'AUDitor'] }),
    );
  });

  test('throws when no auth present', async () => {
    const req = createRequest();
    await expect(authenticateRequest(req)).rejects.toBeInstanceOf(AuthError);
  });
});
