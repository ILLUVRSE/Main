import fs from 'fs';
import path from 'path';
import express from 'express';
import https from 'https';
import { AddressInfo } from 'net';
import request from 'supertest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { authMiddleware, resetAuthCaches } from '../../src/middleware/auth';

const CERT_DIR = path.resolve(__dirname, '../fixtures/certs');
const CA_PATH = path.join(CERT_DIR, 'test-ca.crt');
const SERVER_KEY_PATH = path.join(CERT_DIR, 'test-server.key');
const SERVER_CERT_PATH = path.join(CERT_DIR, 'test-server.crt');
const CLIENT_KEY_PATH = path.join(CERT_DIR, 'test-client.key');
const CLIENT_CERT_PATH = path.join(CERT_DIR, 'test-client.crt');

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
    const app = buildApp();

    const serverOptions: https.ServerOptions = {
      key: fs.readFileSync(SERVER_KEY_PATH),
      cert: fs.readFileSync(SERVER_CERT_PATH),
      ca: fs.readFileSync(CA_PATH),
      requestCert: true,
      rejectUnauthorized: true,
    };

    const server = https.createServer(serverOptions, app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
        const req = https.request(
          {
            hostname: 'localhost',
            port,
            path: '/whoami',
            method: 'GET',
            key: fs.readFileSync(CLIENT_KEY_PATH),
            cert: fs.readFileSync(CLIENT_CERT_PATH),
            ca: fs.readFileSync(CA_PATH),
            rejectUnauthorized: true,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(chunk as Buffer));
            res.on('end', () => {
              resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
            });
          },
        );
        req.on('error', reject);
        req.end();
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.body);
      expect(payload.principal).toBeDefined();
      expect(payload.principal.id).toBe('svc.kernel');
      expect(payload.principal.roles).toEqual(['Operator']);
      expect(payload.principal.source).toBe('mtls');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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
