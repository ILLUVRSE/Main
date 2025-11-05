// kernel/src/auth/oidc.ts
// Minimal OIDC client + JWKS caching wrapper for local dev and tests.
// Uses the OIDC discovery endpoint to find jwks_uri and verifies JWTs using `jose`.
//
// Usage:
//   import { oidcClient, initOidc } from './auth/oidc';
//   await initOidc(); // once at startup
//   const payload = await oidcClient.verify(token); // throws if invalid
//
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

const OIDC_ISSUER = process.env.OIDC_ISSUER || '';
const OIDC_AUDIENCE = process.env.OIDC_AUDIENCE || process.env.OIDC_CLIENT_ID;

/**
 * Lightweight OIDC client that:
 * - fetches .well-known/openid-configuration
 * - creates a RemoteJWKSet (jose) that includes caching
 * - exposes verify(token) which returns the JWT payload or throws
 */
export class OIDCClient {
  issuer: string;
  audience?: string | undefined;
  jwksUri?: string;
  jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(issuer: string, audience?: string) {
    if (!issuer) throw new Error('OIDC_ISSUER is required');
    this.issuer = issuer.replace(/\/$/, '');
    this.audience = audience;
  }

  /**
   * Initialize by fetching discovery and preparing jwks.
   * Safe to call multiple times (idempotent).
   */
  async init(): Promise<void> {
    if (this.jwks) return;

    const discoveryUrl = `${this.issuer}/.well-known/openid-configuration`;
    // use global fetch (Node 18+). If you run older Node, install node-fetch and swap here.
    // @ts-ignore
    const res = await (globalThis as any).fetch(discoveryUrl, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);
    }
    const disco = await res.json();
    this.jwksUri = disco.jwks_uri;
    if (!this.jwksUri) throw new Error('jwks_uri not present in OIDC discovery');
    this.jwks = createRemoteJWKSet(new URL(this.jwksUri));
  }

  /**
   * Verify a JWT (access or id token).
   * - token: the compact serialized JWT string
   * - opts.audience: optional override audience (defaults to configured audience)
   *
   * Returns the token payload (JWTPayload) on success, otherwise throws.
   */
  async verify(token: string, opts?: { audience?: string }): Promise<JWTPayload> {
    if (!this.jwks) throw new Error('OIDC client not initialized; call init() first');

    const audience = opts?.audience ?? this.audience;
    const verifyOpts: any = {
      issuer: this.issuer,
    };
    if (audience) verifyOpts.audience = audience;

    const { payload } = await jwtVerify(token, this.jwks as any, verifyOpts);
    return payload as JWTPayload;
  }
}

/**
 * Export a singleton client created from env vars.
 * Call `initOidc()` once (for example in server startup) to fetch discovery & JWKs.
 */
export const oidcClient = new OIDCClient(
  OIDC_ISSUER,
  OIDC_AUDIENCE,
);

export async function initOidc(): Promise<void> {
  await oidcClient.init();
}

