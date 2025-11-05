// kernel/src/auth/middleware.ts
import { Request, Response, NextFunction } from 'express';
import { oidcClient } from './oidc';
import { Principal } from '../rbac';

/**
 * Extract commonName from Node's getPeerCertificate() output. Works with:
 *  - cert.subject = { CN: '...' } or { commonName: '...' }
 *  - cert.subject.CN or cert.subject.commonName
 *  - cert.subjectString fallback
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
  if (cert.CN) return cert.CN;
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
 * Middleware: try bearer JWT verification (OIDC), else try mTLS client cert.
 * - On success attaches req.principal and calls next()
 * - On failure (invalid token) it logs and continues without principal (do not block here)
 *
 * Note: Handlers / RBAC must enforce principal/roles as needed.
 */
export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    // 1) Bearer token (preferred)
    const authHeader = (req.headers.authorization || '') as string;
    const m = authHeader.match(/^\s*Bearer\s+(.+)\s*$/i);
    if (m) {
      const token = m[1];
      try {
        // lazy-init jwks if needed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((oidcClient as any).jwks === undefined) {
          try {
            // init() is idempotent
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (oidcClient as any).init();
          } catch (e) {
            console.warn('authMiddleware: oidc init failed:', (e as Error).message || e);
          }
        }

        // verify token; throws on invalid
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload: any = await (oidcClient as any).verify(token);

        // collect roles: try common claim shapes
        let roles: string[] = [];
        if (payload.realm_access && Array.isArray(payload.realm_access.roles)) {
          roles = payload.realm_access.roles as string[];
        } else if (payload.resource_access) {
          const ra = payload.resource_access;
          const all: string[] = [];
          for (const k of Object.keys(ra || {})) {
            const r = ra[k]?.roles;
            if (Array.isArray(r)) all.push(...r);
          }
          if (all.length) roles = all;
        } else if (Array.isArray(payload.roles)) {
          roles = payload.roles;
        } else if (payload.scope && typeof payload.scope === 'string') {
          roles = (payload.scope as string).split(/\s+/).filter(Boolean);
        }

        // Attach canonical Principal (rbac.Principal expects type: 'human' for users)
        const principal: Principal = {
          type: 'human',
          id: String(payload.sub ?? payload.sid ?? payload.subject ?? 'unknown'),
          roles: roles || [],
        };
        req.principal = principal;
        return next();
      } catch (err) {
        // Don't block if token invalid — handlers should enforce.
        console.warn('authMiddleware: bearer token verify failed — continuing unauthenticated:', (err as Error).message || err);
      }
    }

    // 2) mTLS client cert extraction (Node http/https)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sock: any = (req as any).socket || (req as any).connection;
      if (sock && typeof sock.getPeerCertificate === 'function') {
        const cert = sock.getPeerCertificate(true);
        const hasCert = cert && Object.keys(cert).length > 0;
        if (hasCert) {
          const cn = extractCNFromCert(cert);
          const san = extractSAN(cert);
          const id = cn || (cert.subject ? JSON.stringify(cert.subject) : 'service-unknown');

          const principal: Principal = {
            type: 'service',
            id,
            roles: [], // service roles mapping left empty for now — RBAC can map later
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

