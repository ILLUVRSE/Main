// server/src/middleware/auth.ts
import type { Request, Response, NextFunction } from 'express';
import { jwtVerify, createRemoteJWKSet } from 'jose';

export interface AuthUser { sub?: string; roles?: string[]; [k:string]: any; }

/**
 * requireAuth(roles?) - middleware that ensures a valid Bearer JWT is present.
 * Development note: if JWT_SECRET env var present, it uses HMAC verify; otherwise,
 * you should configure JWKS via JWT_JWKS_URL in production.
 */
export function requireAuth(roles?: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const hdr = req.headers.authorization;
    if (!hdr || !hdr.startsWith('Bearer ')) {
      return res.status(401).json({ ok:false, error:{ code:'unauthorized', message:'Missing Bearer token' }});
    }
    const token = hdr.slice(7);
    try {
      const secret = process.env.JWT_SECRET;
      let payload: any;
      if (secret) {
        const { payload: p } = await jwtVerify(token, new TextEncoder().encode(secret));
        payload = p;
      } else if (process.env.JWT_JWKS_URL) {
        const JWKS = createRemoteJWKSet(new URL(process.env.JWT_JWKS_URL));
        const { payload: p } = await jwtVerify(token, JWKS);
        payload = p;
      } else {
        return res.status(500).json({ ok:false, error:{ code:'server_error', message:'No JWT verifier configured' }});
      }
      (req as any).user = payload as AuthUser;
      if (roles && roles.length > 0) {
        const userRoles = Array.isArray(payload.roles) ? payload.roles : [];
        if (!roles.some(r => userRoles.includes(r))) {
          return res.status(403).json({ ok:false, error:{ code:'forbidden', message:'Missing required role' }});
        }
      }
      return next();
    } catch (err:any) {
      console.warn('auth error', err?.message ?? err);
      return res.status(401).json({ ok:false, error:{ code:'unauthorized', message: 'Invalid token' }});
    }
  };
}

