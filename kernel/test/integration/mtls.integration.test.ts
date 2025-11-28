import express from 'express';
import type { Request } from 'express';
import request from '../utils/mockSupertest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { authMiddleware, authenticateRequest, resetAuthCaches } from '../../src/middleware/auth';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    Promise.resolve(authMiddleware(req as any, res as any, next)).catch(next);
  });
  app.get('/whoami', (req, res) => {
    const principal = (req as any).principal ?? null;
    if (!principal) {
      return res.status(401).json({ error: 'unauthenticated' });
    }
    return res.json({ principal });
  });
  return app;
}

describe('mTLS integration', () => {
  let privateKey: any;
  let publicJwk: any;
  const issuer = 'https://issuer.integration.test';
  const audience = 'kernel-api';
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    publicJwk.kid = 'integration-mtls';
  });

  beforeEach(() => {
    process.env.KERNEL_OIDC_CONFIG_JSON = JSON.stringify({
      issuer,
      audience,
      jwks: { keys: [publicJwk] },
    });
    process.env.SERVICE_ROLE_MAP = JSON.stringify({ 'svc.kernel': ['Operator'] });
    process.env.NODE_ENV = 'test';
    resetAuthCaches();
  });

  afterEach(() => {
    delete process.env.KERNEL_OIDC_CONFIG_JSON;
    delete process.env.SERVICE_ROLE_MAP;
    resetAuthCaches();
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  async function signToken(subject: string, roles: string[] = ['Operator']) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ roles })
      .setProtectedHeader({ alg: 'RS256', kid: 'integration-mtls' })
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .sign(privateKey);
  }

  test('authenticates service-to-service call via mTLS', async () => {
    process.env.NODE_ENV = 'production';
    const fakeSocket = {
      encrypted: true,
      authorized: true,
      authorizationError: null,
      getPeerCertificate: () => ({
        subject: { CN: 'svc.kernel' },
        fingerprint256: 'abc',
      }),
    };
    const req = {
      path: '/whoami',
      headers: {},
      socket: fakeSocket,
    } as unknown as Request;

    const principal = await authenticateRequest(req);
    expect(principal.id).toBe('svc.kernel');
    expect(principal.roles).toEqual(['Operator']);
    expect(principal.source).toBe('mtls');
  });

  test('falls back to bearer token authentication for local development', async () => {
    process.env.NODE_ENV = 'development';
    const app = buildApp();
    const token = await signToken('user.dev');

    const res = await request(app).get('/whoami').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.principal.id).toBe('user.dev');
    expect(res.body.principal.source).toBe('oidc');
  });
});
