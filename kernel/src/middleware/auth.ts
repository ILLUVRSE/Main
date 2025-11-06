import fs from 'fs';
import path from 'path';
import { IncomingHttpHeaders } from 'http';
import { Request, Response, NextFunction } from 'express';
import { JWTPayload, createLocalJWKSet, createRemoteJWKSet, jwtVerify, JWK } from 'jose';
import { logger } from '../logger';

export type PrincipalType = 'human' | 'service';

export interface AuthenticatedPrincipal {
  id: string;
  type: PrincipalType;
  roles: string[];
  source: 'oidc' | 'mtls';
  issuer?: string;
  metadata?: Record<string, unknown>;
  tokenClaims?: JWTPayload;
}

export interface AuthContext {
  principal: AuthenticatedPrincipal;
  token?: string;
}

type JwkResolver = ReturnType<typeof createRemoteJWKSet> | ReturnType<typeof createLocalJWKSet>;

type JsonWebKeySet = { keys: JWK[] };

type OidcConfig = {
  issuer: string;
  audience?: string;
  jwksUri?: string;
  jwksPath?: string;
  jwks?: JsonWebKeySet;
};

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), 'config/oidc.json');
const ALT_CONFIG_PATH = path.resolve(process.cwd(), 'kernel/config/oidc.json');

let cachedConfig: OidcConfig | null = null;
let cachedJwkResolver: JwkResolver | null = null;

export class AuthError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function readConfigFile(filePath: string): OidcConfig | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return normalizeConfig(parsed);
  } catch (err) {
    logger.warn('auth.config.read_failed', { path: filePath, error: (err as Error).message });
    return null;
  }
}

function normalizeConfig(value: Record<string, any>): OidcConfig {
  const issuer = String(value.issuer || value.iss || '').trim();
  const audience = value.audience || value.clientId || value.client_id;
  const jwksUri = value.jwksUri || value.jwks_uri;
  const jwksPath = value.jwksPath || value.jwks_path;
  const jwks = value.jwks;
  if (!issuer) {
    throw new Error('OIDC issuer missing in config');
  }
  const cfg: OidcConfig = { issuer, audience, jwksUri, jwksPath, jwks };
  return cfg;
}

function loadOidcConfig(): OidcConfig {
  if (cachedConfig) return cachedConfig;

  const envJson = process.env.KERNEL_OIDC_CONFIG_JSON;
  if (envJson) {
    try {
      cachedConfig = normalizeConfig(JSON.parse(envJson));
      return cachedConfig;
    } catch (err) {
      throw new Error(`Failed to parse KERNEL_OIDC_CONFIG_JSON: ${(err as Error).message}`);
    }
  }

  const envPath = process.env.KERNEL_OIDC_CONFIG_PATH;
  if (envPath) {
    const cfg = readConfigFile(path.resolve(envPath));
    if (cfg) {
      cachedConfig = cfg;
      return cachedConfig;
    }
    throw new Error(`OIDC config not found at ${envPath}`);
  }

  const candidatePaths = [DEFAULT_CONFIG_PATH, ALT_CONFIG_PATH];
  for (const candidate of candidatePaths) {
    const cfg = readConfigFile(candidate);
    if (cfg) {
      cachedConfig = cfg;
      return cachedConfig;
    }
  }

  throw new Error('Unable to locate OIDC config; set KERNEL_OIDC_CONFIG_PATH or KERNEL_OIDC_CONFIG_JSON');
}

async function getJwkResolver(): Promise<JwkResolver> {
  if (cachedJwkResolver) return cachedJwkResolver;
  const config = loadOidcConfig();

  if (config.jwks && Array.isArray(config.jwks.keys)) {
    cachedJwkResolver = createLocalJWKSet(config.jwks as JsonWebKeySet);
    return cachedJwkResolver;
  }

  if (config.jwksPath) {
    const absolute = path.resolve(config.jwksPath);
    const raw = fs.readFileSync(absolute, 'utf8');
    const parsed = JSON.parse(raw) as JsonWebKeySet;
    cachedJwkResolver = createLocalJWKSet(parsed);
    return cachedJwkResolver;
  }

  if (config.jwksUri) {
    cachedJwkResolver = createRemoteJWKSet(new URL(String(config.jwksUri)));
    return cachedJwkResolver;
  }

  throw new Error('OIDC configuration missing jwksUri/jwksPath/jwks');
}

function parseRoles(claims: JWTPayload): string[] {
  const roles = new Set<string>();
  const add = (value?: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((v) => {
        if (typeof v === 'string' && v.trim()) roles.add(v.trim());
      });
    } else if (typeof value === 'string') {
      value
        .split(/[\s,]+/)
        .map((v) => v.trim())
        .filter(Boolean)
        .forEach((v) => roles.add(v));
    }
  };

  if (claims.roles) add(claims.roles);
  if (claims.scope) add(claims.scope);

  const realmAccess = (claims as any).realm_access;
  if (realmAccess && Array.isArray(realmAccess.roles)) add(realmAccess.roles);

  const resourceAccess = (claims as any).resource_access;
  if (resourceAccess && typeof resourceAccess === 'object') {
    Object.values(resourceAccess).forEach((entry) => {
      if (entry && typeof entry === 'object' && Array.isArray((entry as any).roles)) {
        add((entry as any).roles);
      }
    });
  }

  return Array.from(roles);
}

function extractServiceRoles(serviceId: string): string[] {
  const mapRaw = process.env.SERVICE_ROLE_MAP;
  if (!mapRaw) return [];
  try {
    const parsed = JSON.parse(mapRaw);
    const roles = parsed?.[serviceId];
    if (!roles) return [];
    if (Array.isArray(roles)) return roles.map((r) => String(r));
    if (typeof roles === 'string') {
      return roles
        .split(/[\s,]+/)
        .map((v: string) => v.trim())
        .filter(Boolean);
    }
    return [];
  } catch (err) {
    logger.warn('auth.service_role_map.invalid', { error: (err as Error).message });
    return [];
  }
}

function rolesFromHeaders(headers: IncomingHttpHeaders): string[] {
  const headerRoles = headers['x-roles'] || headers['x-user-roles'];
  if (!headerRoles) return [];
  if (Array.isArray(headerRoles)) {
    return headerRoles.flatMap((value) => value.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean));
  }
  return String(headerRoles)
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

async function authenticateBearerToken(req: Request, token: string): Promise<AuthenticatedPrincipal> {
  const jwkResolver = await getJwkResolver();
  const config = loadOidcConfig();

  const { payload } = await jwtVerify(token, jwkResolver, {
    issuer: config.issuer,
    audience: config.audience,
  });

  const subject = String(payload.sub || payload.sid || payload.preferred_username || 'unknown');
  const roles = parseRoles(payload);
  const headerRoles = rolesFromHeaders(req.headers);
  headerRoles.forEach((role) => roles.push(role));

  const principal: AuthenticatedPrincipal = {
    id: subject,
    type: 'human',
    roles: Array.from(new Set(roles)),
    source: 'oidc',
    issuer: config.issuer,
    metadata: { audience: config.audience },
    tokenClaims: payload,
  };

  return principal;
}

function extractCertificatePrincipal(req: Request): AuthenticatedPrincipal | null {
  const socket: any = (req as any).socket || (req as any).connection;
  if (!socket || typeof socket.getPeerCertificate !== 'function') return null;

  try {
    const cert = socket.getPeerCertificate(true);
    if (!cert || Object.keys(cert).length === 0) return null;

    const authorized = Boolean(socket.authorized);
    const allowSelfSigned = (process.env.NODE_ENV !== 'production' && socket.authorizationError)
      || process.env.KERNEL_ALLOW_INSECURE_MTLS === 'true';
    if (!authorized && !allowSelfSigned) {
      throw new AuthError(401, 'mtls.unauthorized', socket.authorizationError || 'client certificate not authorized');
    }

    const subject = cert.subject || {};
    const id = subject.CN || subject.commonName || cert.subjectaltname || cert.subjectAltName;
    if (!id) {
      throw new AuthError(401, 'mtls.subject_missing', 'client certificate missing common name');
    }

    const roles = extractServiceRoles(String(id));

    return {
      id: String(id),
      type: 'service',
      roles,
      source: 'mtls',
      metadata: {
        fingerprint256: cert.fingerprint256 || cert.fingerprint || null,
      },
    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError(401, 'mtls.error', (err as Error).message);
  }
}

export async function authenticateRequest(req: Request): Promise<AuthenticatedPrincipal> {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (typeof authHeader === 'string' && /^\s*Bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim();
    if (!token) {
      throw new AuthError(401, 'token.missing', 'Bearer token missing');
    }
    try {
      const principal = await authenticateBearerToken(req, token);
      logger.audit('auth.success', {
        subject: principal.id,
        source: 'oidc',
        path: req.path,
      });
      return principal;
    } catch (err) {
      logger.warn('auth.token.invalid', {
        error: (err as Error).message,
        path: req.path,
      });
      throw new AuthError(401, 'token.invalid', 'Token verification failed');
    }
  }

  const certPrincipal = extractCertificatePrincipal(req);
  if (certPrincipal) {
    logger.audit('auth.success', {
      subject: certPrincipal.id,
      source: 'mtls',
      path: req.path,
    });
    return certPrincipal;
  }

  throw new AuthError(401, 'unauthenticated', 'Authentication required');
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const principal = await authenticateRequest(req);
    req.principal = principal;
    req.authContext = { principal };
    return next();
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.code });
    }
    return next(err);
  }
}

export function resetAuthCaches() {
  cachedConfig = null;
  cachedJwkResolver = null;
}

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext;
    }
  }
}

// Internal helpers exported for tests
export const __testInternals = {
  loadOidcConfig,
  getJwkResolver,
};
