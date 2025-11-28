import { RequestHandler } from 'express';

export interface SecurityOptions {
  requireMtls: boolean;
  requireOidc: boolean;
}

export function mtlsMiddleware(options: SecurityOptions): RequestHandler {
  return (req, res, next) => {
    if (!options.requireMtls) return next();
    const authorized =
      (req.socket as any)?.authorized ||
      (req.connection as any)?.authorized ||
      (req as any).client?.authorized;
    if (authorized) return next();
    res.status(401).json({ error: 'mTLS client certificate required' });
  };
}

export function oidcMiddleware(options: SecurityOptions): RequestHandler {
  return (req, res, next) => {
    if (!options.requireOidc) return next();
    const authz = req.headers.authorization;
    if (!authz) {
      return res.status(401).json({ error: 'OIDC token required' });
    }
    // Full token validation is delegated to upstream proxy; here we only enforce presence.
    return next();
  };
}

export function resolveSecurity(): SecurityOptions {
  const env = process.env.NODE_ENV || 'development';
  const devSkipMtls = String(process.env.DEV_SKIP_MTLS).toLowerCase() === 'true';
  if (env === 'production' && devSkipMtls) {
    throw new Error('DEV_SKIP_MTLS is not allowed in production');
  }
  const requireMtls = env === 'production' ? true : !devSkipMtls;
  const requireOidc = String(process.env.REQUIRE_OIDC).toLowerCase() === 'true';
  return { requireMtls, requireOidc };
}
