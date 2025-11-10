// kernel/src/auth/middleware.ts
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { oidcClient } from './oidc';
import { Principal } from '../rbac';

/**
 * Runtime loader for role-mapping utilities to avoid circular imports.
 */
function loadRoleMapper(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./roleMapping');
  } catch (e) {
    return null;
  }
}

/**
 * Base64url decode utility (returns UTF-8 string)
 */
function base64UrlDecode(input: string): string {
  let s = input.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

/**
 * Parse JWT header without verification
 */
function parseJwtHeader(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const headerStr = base64UrlDecode(parts[0]);
    return JSON.parse(headerStr);
  } catch {
    return null;
  }
}

/**
 * verify HS256 JWT compact token using provided secret.
 * Returns parsed payload (object) on success, throws on failure.
 */
function verifyHs256Token(token: string, secret: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid token format');
  const signingInput = parts[0] + '.' + parts[1];
  const sig = parts[2];

  const h = crypto.createHmac('sha256', secret).update(signingInput).digest();
  const expected = h.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    throw new Error('invalid signature');
  }

  const payloadJson = base64UrlDecode(parts[1]);
  return JSON.parse(payloadJson);
}

/**
 * Extract commonName from Node's getPeerCertificate() output.
 */
function extractCNFromCert(cert: any): string | undefined {
  if (!cert) return undefined;
  const subj = cert.subject || cert.subjectCertificate || cert.issuerCertificate;
  if (subj) {
    if (typeof subj === 'object') {
      return (subj.CN || subj.commonName) as string | undefined;
    }
    if (typeof subj === 'string') {
      const m = subj.match(/\/CN=([^\/,;+]+)/);
      if (m) return m[1];
    }
  }
  if ((cert as any).CN) return (cert as any).CN;
  return undefined;
}

/**
 * Extract SAN if present
 */
function extractSAN(cert: any): string | undefined {
  if (!cert) return undefined;
  if (cert.subjectaltname) return cert.subjectaltname;
  if (cert.altNames) return cert.altNames;
  return undefined;
}

/**
 * Middleware: try bearer JWT verification (HS256 fast path), then mTLS client cert.
 * We DO NOT call oidcClient.init() from the middleware to avoid performing network
 * discovery during request-handling. OIDC verification only runs when `oidcClient.jwks`
 * is already present (i.e., server startup called initOidc()).
 */
export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const mapper = loadRoleMapper();

    // 1) Bearer token (preferred)
    const authHeader = (req.headers.authorization || '') as string;
    const m = authHeader.match(/^\s*Bearer\s+(.+)\s*$/i);
    if (m) {
      const token = m[1];

      // Fast-path: if token header indicates HS256, try test/secret-based verification
      try {
        const header = parseJwtHeader(token);
        if (header && typeof header.alg === 'string' && header.alg.toUpperCase() === 'HS256') {
          const secret =
            (process.env.TEST_CLIENT_SECRET && process.env.TEST_CLIENT_SECRET.length > 0
              ? process.env.TEST_CLIENT_SECRET
              : undefined) ||
            (process.env.CLIENT_SECRET && process.env.CLIENT_SECRET.length > 0 ? process.env.CLIENT_SECRET : undefined);

          if (secret) {
            try {
              const payload = verifyHs256Token(token, secret);
              let roles: string[] = [];
              if (Array.isArray(payload?.roles)) roles = payload.roles;
              else if (payload?.scope && typeof payload.scope === 'string') {
                roles = (payload.scope as string).split(/\s+/).filter(Boolean);
              }
              if (mapper && typeof mapper.mapOidcRolesToCanonical === 'function') {
                try {
                  roles = mapper.mapOidcRolesToCanonical(roles || []);
                } catch {
                  // ignore
                }
              }

              const principal: Principal = {
                type: 'human',
                id: String(payload?.sub ?? payload?.sid ?? payload?.subject ?? 'unknown'),
                roles: roles || [],
              };

              req.principal = principal;
              return next();
            } catch (e) {
              console.warn('authMiddleware: HS256 token verification failed — continuing unauthenticated:', (e as Error).message || e);
            }
          } else {
            console.warn('authMiddleware: HS256 token presented but no TEST_CLIENT_SECRET/CLIENT_SECRET configured — skipping HS256 verification.');
          }
        }
      } catch (e) {
        // Parsing header failed — continue to other paths
      }

      // OIDC verification: ONLY attempt if jwks already present (initialized at server start).
      try {
        if ((oidcClient as any).jwks) {
          try {
            const payload: any = await (oidcClient as any).verify(token);

            if (mapper && typeof mapper.principalFromOidcClaims === 'function') {
              try {
                const p = mapper.principalFromOidcClaims(payload) as Principal;
                p.id = String(p.id || payload.sub || payload.sid || 'unknown');
                p.roles = p.roles || [];
                req.principal = p;
                return next();
              } catch (e) {
                console.warn('authMiddleware: roleMapper.principalFromOidcClaims failed, falling back:', (e as Error).message || e);
              }
            }

            let roles: string[] = [];
            if (payload?.realm_access && Array.isArray(payload.realm_access.roles)) {
              roles = payload.realm_access.roles as string[];
            } else if (payload?.resource_access && typeof payload.resource_access === 'object') {
              const ra = payload.resource_access;
              const all: string[] = [];
              for (const k of Object.keys(ra || {})) {
                const r = ra[k]?.roles;
                if (Array.isArray(r)) all.push(...r);
              }
              if (all.length) roles = all;
            } else if (Array.isArray(payload?.roles)) {
              roles = payload.roles;
            } else if (payload?.scope && typeof payload.scope === 'string') {
              roles = (payload.scope as string).split(/\s+/).filter(Boolean);
            }

            if (mapper && typeof mapper.mapOidcRolesToCanonical === 'function') {
              try {
                roles = mapper.mapOidcRolesToCanonical(roles || []);
              } catch {
                // ignore
              }
            }

            const principal: Principal = {
              type: 'human',
              id: String(payload?.sub ?? payload?.sid ?? payload?.subject ?? 'unknown'),
              roles: roles || [],
            };

            req.principal = principal;
            return next();
          } catch (err) {
            console.warn('authMiddleware: oidc token verify failed — continuing unauthenticated:', (err as Error).message || err);
          }
        }
      } catch (err) {
        console.warn('authMiddleware: oidc processing error — continuing unauthenticated:', (err as Error).message || err);
      }
    }

    // 2) mTLS client cert extraction (Node http/https)
    try {
      // @ts-ignore
      const sock: any = (req as any).socket || (req as any).connection;
      if (sock && typeof sock.getPeerCertificate === 'function') {
        const cert = sock.getPeerCertificate(true);
        const hasCert = cert && Object.keys(cert).length > 0;
        if (hasCert) {
          if (mapper && typeof mapper.principalFromCert === 'function') {
            try {
              const p = mapper.principalFromCert(cert) as Principal;
              p.roles = p.roles || [];
              req.principal = p;
              return next();
            } catch (e) {
              console.warn('authMiddleware: roleMapper.principalFromCert failed, falling back:', (e as Error).message || e);
            }
          }

          const cn = extractCNFromCert(cert);
          const san = extractSAN(cert);
          const id = cn || (cert?.subject ? JSON.stringify(cert.subject) : (san || 'service-unknown'));

          const principal: Principal = {
            type: 'service',
            id,
            roles: [],
          };
          req.principal = principal;
          return next();
        }
      }
    } catch (err) {
      console.warn('authMiddleware: cert parse error — continuing unauthenticated:', (err as Error).message || err);
    }

    // 3) No principal found — continue unauthenticated (rbac.getPrincipalFromRequest will still work for dev headers)
    return next();
  } catch (err) {
    return next(err);
  }
}

