// kernel/src/auth/oidc.ts
// Minimal OIDC client + JWKS caching wrapper for local dev and tests.
// Uses the OIDC discovery endpoint to find jwks_uri and verifies JWTs using `jose`.
//
// Usage:
//   import { oidcClient, initOidc, getJwtClaims, parseOidcClaims, jwksReady } from './auth/oidc';
//   await initOidc(); // once at startup
//   const payload = await getJwtClaims(token); // throws if invalid
//   const claims = parseOidcClaims(payload); // normalized claim shape

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
    // Allow empty issuer at construction time (useful for tests). init() enforces issuer presence.
    this.issuer = issuer ? issuer.replace(/\/$/, '') : '';
    this.audience = audience;
  }

  /**
   * Initialize by fetching discovery and preparing jwks.
   * Safe to call multiple times (idempotent).
   */
  async init(): Promise<void> {
    if (this.jwks) return;
    if (!this.issuer) throw new Error('OIDC_ISSUER is required');

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
export const oidcClient = new OIDCClient(OIDC_ISSUER, OIDC_AUDIENCE);

export async function initOidc(): Promise<void> {
  await oidcClient.init();
}

/**
 * Helper: getJwtClaims
 * Small wrapper around oidcClient.verify that returns the JWT payload.
 * Ensures client has been initialized first (callers may call initOidc()).
 */
export async function getJwtClaims(token: string, opts?: { audience?: string }): Promise<JWTPayload> {
  // If jwks not initialized, try to init but do not crash if issuer empty — leave to caller
  if (!oidcClient.jwks) {
    try {
      await oidcClient.init();
    } catch (e) {
      // rethrow with explanatory message
      throw new Error(`OIDC client not initialized and init failed: ${(e as Error).message || e}`);
    }
  }
  return await oidcClient.verify(token, opts);
}

/**
 * Helper: parseOidcClaims
 * Normalize common OIDC claim shapes into a predictable structure that downstream
 * role-mapping logic can consume reliably.
 *
 * The returned object includes:
 *  - sub: subject
 *  - realm_access: { roles: string[] } (ensured array)
 *  - resource_access: preserved if present
 *  - roles: top-level roles array (if present)
 *  - groups: array (if present)
 *  - scope: unchanged (string)
 *
 * This function is defensive and preserves unknown claim keys.
 */
export function parseOidcClaims(payload: JWTPayload): Record<string, any> {
  const claims: Record<string, any> = { ...(payload as Record<string, any>) };

  // Ensure subject normalized
  claims.sub = String(claims.sub ?? claims.uid ?? claims.user_id ?? claims.preferred_username ?? claims.preferredUsername ?? '');

  // Normalize realm_access.roles -> array
  if (claims.realm_access) {
    try {
      const ra = claims.realm_access;
      if (ra && Array.isArray(ra.roles)) {
        claims.realm_access = { roles: ra.roles.slice() };
      } else if (ra && typeof ra.roles === 'string') {
        claims.realm_access = { roles: (ra.roles as string).split(/[,\s]+/).filter(Boolean) };
      } else {
        claims.realm_access = { roles: [] };
      }
    } catch {
      claims.realm_access = { roles: [] };
    }
  } else {
    claims.realm_access = { roles: [] };
  }

  // Preserve resource_access shape; ensure roles arrays if present
  if (claims.resource_access && typeof claims.resource_access === 'object') {
    const ra: Record<string, any> = {};
    for (const k of Object.keys(claims.resource_access)) {
      const entry = claims.resource_access[k] || {};
      if (Array.isArray(entry.roles)) ra[k] = { roles: entry.roles.slice() };
      else if (entry.roles && typeof entry.roles === 'string') ra[k] = { roles: (entry.roles as string).split(/[,\s]+/).filter(Boolean) };
      else ra[k] = { roles: [] };
    }
    claims.resource_access = ra;
  } else {
    claims.resource_access = {};
  }

  // top-level roles normalization
  if (Array.isArray(claims.roles)) {
    claims.roles = claims.roles.slice();
  } else if (typeof claims.roles === 'string') {
    claims.roles = (claims.roles as string).split(/[,\s]+/).filter(Boolean);
  } else {
    // leave undefined or set to empty array depending on your downstream needs
    claims.roles = claims.roles ?? [];
  }

  // groups normalization
  if (Array.isArray(claims.groups)) {
    claims.groups = claims.groups.slice();
  } else if (typeof claims.groups === 'string') {
    claims.groups = (claims.groups as string).split(/[,\s]+/).filter(Boolean);
  } else {
    claims.groups = claims.groups ?? [];
  }

  // scope left as string if present
  if (typeof claims.scope === 'string') {
    claims.scope = claims.scope;
  }

  return claims;
}

export type OidcClaims = ReturnType<typeof parseOidcClaims>;

/**
 * Helper: jwksReady()
 * Tests/startup can check whether the JWKs have been prepared without calling init()
 */
export function jwksReady(): boolean {
  return !!oidcClient.jwks;
}

