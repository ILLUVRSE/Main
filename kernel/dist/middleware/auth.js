"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.__testInternals = exports.AuthError = void 0;
exports.authenticateRequest = authenticateRequest;
exports.authMiddleware = authMiddleware;
exports.resetAuthCaches = resetAuthCaches;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const jose_1 = require("jose");
const logger_1 = require("../logger");
const roleMapping_1 = require("../auth/roleMapping");
const DEFAULT_CONFIG_PATH = path_1.default.resolve(process.cwd(), 'config/oidc.json');
const ALT_CONFIG_PATH = path_1.default.resolve(process.cwd(), 'kernel/config/oidc.json');
let cachedConfig = null;
let cachedJwkResolver = null;
class AuthError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
exports.AuthError = AuthError;
function readConfigFile(filePath) {
    try {
        if (!fs_1.default.existsSync(filePath))
            return null;
        const raw = fs_1.default.readFileSync(filePath, 'utf8');
        if (!raw.trim())
            return null;
        const parsed = JSON.parse(raw);
        return normalizeConfig(parsed);
    }
    catch (err) {
        logger_1.logger.warn('auth.config.read_failed', { path: filePath, error: err.message });
        return null;
    }
}
function normalizeConfig(value) {
    const issuer = String(value.issuer || value.iss || '').trim();
    const audience = value.audience || value.clientId || value.client_id;
    const jwksUri = value.jwksUri || value.jwks_uri;
    const jwksPath = value.jwksPath || value.jwks_path;
    const jwks = value.jwks;
    if (!issuer) {
        throw new Error('OIDC issuer missing in config');
    }
    const cfg = { issuer, audience, jwksUri, jwksPath, jwks };
    return cfg;
}
function loadOidcConfig() {
    if (cachedConfig)
        return cachedConfig;
    const envJson = process.env.KERNEL_OIDC_CONFIG_JSON;
    if (envJson) {
        try {
            cachedConfig = normalizeConfig(JSON.parse(envJson));
            return cachedConfig;
        }
        catch (err) {
            throw new Error(`Failed to parse KERNEL_OIDC_CONFIG_JSON: ${err.message}`);
        }
    }
    const envPath = process.env.KERNEL_OIDC_CONFIG_PATH;
    if (envPath) {
        const cfg = readConfigFile(path_1.default.resolve(envPath));
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
async function getJwkResolver() {
    if (cachedJwkResolver)
        return cachedJwkResolver;
    const config = loadOidcConfig();
    if (config.jwks && Array.isArray(config.jwks.keys)) {
        cachedJwkResolver = (0, jose_1.createLocalJWKSet)(config.jwks);
        return cachedJwkResolver;
    }
    if (config.jwksPath) {
        const absolute = path_1.default.resolve(config.jwksPath);
        const raw = fs_1.default.readFileSync(absolute, 'utf8');
        const parsed = JSON.parse(raw);
        cachedJwkResolver = (0, jose_1.createLocalJWKSet)(parsed);
        return cachedJwkResolver;
    }
    if (config.jwksUri) {
        cachedJwkResolver = (0, jose_1.createRemoteJWKSet)(new URL(String(config.jwksUri)));
        return cachedJwkResolver;
    }
    throw new Error('OIDC configuration missing jwksUri/jwksPath/jwks');
}
function parseRoles(claims) {
    const roles = new Set();
    const add = (value) => {
        if (!value)
            return;
        if (Array.isArray(value)) {
            value.forEach((v) => {
                if (typeof v === 'string' && v.trim())
                    roles.add(v.trim());
            });
        }
        else if (typeof value === 'string') {
            value
                .split(/[\s,]+/)
                .map((v) => v.trim())
                .filter(Boolean)
                .forEach((v) => roles.add(v));
        }
    };
    if (claims.roles)
        add(claims.roles);
    if (claims.scope)
        add(claims.scope);
    const realmAccess = claims.realm_access;
    if (realmAccess && Array.isArray(realmAccess.roles))
        add(realmAccess.roles);
    const resourceAccess = claims.resource_access;
    if (resourceAccess && typeof resourceAccess === 'object') {
        Object.values(resourceAccess).forEach((entry) => {
            if (entry && typeof entry === 'object' && Array.isArray(entry.roles)) {
                add(entry.roles);
            }
        });
    }
    return Array.from(roles);
}
function rolesFromHeaders(headers) {
    const headerRoles = headers['x-roles'] || headers['x-user-roles'];
    if (!headerRoles)
        return [];
    if (Array.isArray(headerRoles)) {
        return headerRoles.flatMap((value) => value.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean));
    }
    return String(headerRoles)
        .split(/[\s,]+/)
        .map((v) => v.trim())
        .filter(Boolean);
}
async function authenticateBearerToken(req, token) {
    const jwkResolver = await getJwkResolver();
    const config = loadOidcConfig();
    const { payload } = await (0, jose_1.jwtVerify)(token, jwkResolver, {
        issuer: config.issuer,
        audience: config.audience,
    });
    const subject = String(payload.sub || payload.sid || payload.preferred_username || 'unknown');
    const roles = parseRoles(payload);
    const headerRoles = rolesFromHeaders(req.headers);
    headerRoles.forEach((role) => roles.push(role));
    const principal = {
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
function isProduction() {
    return (process.env.NODE_ENV || '').toLowerCase() === 'production';
}
function getTlsSocket(req) {
    const socket = req.socket || req.connection;
    if (!socket)
        return null;
    if (typeof socket.getPeerCertificate !== 'function')
        return null;
    if (!socket.encrypted)
        return null;
    return socket;
}
function sanitizeAltName(raw) {
    if (!raw)
        return undefined;
    const text = String(raw);
    const parts = text.split(/[,\s]+/);
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed)
            continue;
        const idx = trimmed.indexOf(':');
        if (idx >= 0) {
            const value = trimmed.slice(idx + 1).trim();
            if (value)
                return value;
        }
        else if (trimmed) {
            return trimmed;
        }
    }
    return undefined;
}
function authenticateMutualTls(req) {
    const socket = getTlsSocket(req);
    if (!socket)
        return null;
    let cert;
    try {
        cert = socket.getPeerCertificate(true);
    }
    catch (err) {
        logger_1.logger.audit('auth.mtls.failure', {
            reason: 'certificate_read_error',
            error: err.message,
            path: req.path,
        });
        throw new AuthError(401, 'mtls.error', 'Failed to read peer certificate');
    }
    const hasCert = cert && Object.keys(cert).length > 0;
    if (!hasCert) {
        if (isProduction()) {
            logger_1.logger.audit('auth.mtls.failure', { reason: 'missing_certificate', path: req.path });
            throw new AuthError(401, 'mtls.missing_cert', 'Client certificate required');
        }
        return null;
    }
    const allowSelfSigned = !isProduction() && process.env.KERNEL_ALLOW_INSECURE_MTLS === 'true';
    const authorized = Boolean(socket.authorized);
    if (!authorized && !allowSelfSigned) {
        const rawReason = socket.authorizationError || 'client certificate not authorized';
        const reason = typeof rawReason === 'string'
            ? rawReason
            : rawReason instanceof Error
                ? rawReason.message
                : String(rawReason);
        logger_1.logger.audit('auth.mtls.failure', {
            reason,
            path: req.path,
            fingerprint: cert.fingerprint256 || cert.fingerprint,
        });
        throw new AuthError(401, 'mtls.unauthorized', reason);
    }
    try {
        const mapped = (0, roleMapping_1.principalFromCert)(cert);
        const commonName = cert.subject?.CN || cert.subject?.commonName || cert.subjectCN || cert.CN;
        const altName = sanitizeAltName(cert.subjectaltname || cert.subjectAltName || cert.altNames);
        const id = String(mapped?.id || commonName || altName || 'service-unknown');
        const roles = Array.isArray(mapped?.roles) ? mapped.roles.map((r) => String(r)) : [];
        const principal = {
            id,
            type: mapped?.type === 'human' ? 'human' : 'service',
            roles: Array.from(new Set(roles)),
            source: 'mtls',
            metadata: {
                commonName: commonName || null,
                subjectAltName: altName || null,
                fingerprint256: cert.fingerprint256 || cert.fingerprint || null,
                authorized: authorized || allowSelfSigned,
                authorizationError: socket.authorizationError || null,
            },
        };
        logger_1.logger.audit('auth.mtls.success', { subject: principal.id, roles: principal.roles, path: req.path });
        return principal;
    }
    catch (err) {
        logger_1.logger.audit('auth.mtls.failure', {
            reason: err.message,
            path: req.path,
            fingerprint: cert?.fingerprint256 || cert?.fingerprint,
        });
        if (err instanceof AuthError)
            throw err;
        throw new AuthError(401, 'mtls.mapping_failed', 'Failed to map client certificate');
    }
}
function parseLocalDevPrincipal(req) {
    const headerValue = req.headers['x-local-dev-principal'];
    if (!headerValue || isProduction())
        return null;
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!raw || typeof raw !== 'string')
        return null;
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        parsed = null;
    }
    const keyValues = {};
    if (parsed && typeof parsed === 'object') {
        Object.assign(keyValues, parsed);
    }
    else {
        const segments = raw.split(';');
        for (const segment of segments) {
            const trimmed = segment.trim();
            if (!trimmed)
                continue;
            const [k, ...rest] = trimmed.split('=');
            if (!k)
                continue;
            keyValues[k.trim().toLowerCase()] = rest.join('=').trim();
        }
        if (!keyValues.id) {
            keyValues.id = raw.trim();
        }
    }
    const id = String(keyValues.id || keyValues.subject || 'local-dev');
    const typeRaw = String(keyValues.type || keyValues.principalType || 'service').toLowerCase();
    const type = typeRaw === 'human' ? 'human' : 'service';
    const rolesRaw = keyValues.roles;
    let roles = [];
    if (Array.isArray(rolesRaw)) {
        roles = rolesRaw.map((r) => String(r));
    }
    else if (typeof rolesRaw === 'string') {
        roles = rolesRaw
            .split(/[\s,]+/)
            .map((r) => r.trim())
            .filter(Boolean);
    }
    const principal = {
        id,
        type,
        roles,
        source: 'dev',
        metadata: { header: 'x-local-dev-principal' },
    };
    logger_1.logger.audit('auth.dev.success', { subject: principal.id, roles: principal.roles, path: req.path });
    return principal;
}
async function authenticateRequest(req) {
    const certPrincipal = authenticateMutualTls(req);
    if (certPrincipal)
        return certPrincipal;
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (typeof authHeader === 'string' && /^\s*Bearer\s+/i.test(authHeader)) {
        const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim();
        if (!token) {
            throw new AuthError(401, 'token.missing', 'Bearer token missing');
        }
        try {
            const principal = await authenticateBearerToken(req, token);
            logger_1.logger.audit('auth.success', {
                subject: principal.id,
                source: 'oidc',
                path: req.path,
            });
            return principal;
        }
        catch (err) {
            logger_1.logger.warn('auth.token.invalid', {
                error: err.message,
                path: req.path,
            });
            throw new AuthError(401, 'token.invalid', 'Token verification failed');
        }
    }
    const devPrincipal = parseLocalDevPrincipal(req);
    if (devPrincipal)
        return devPrincipal;
    throw new AuthError(401, 'unauthenticated', 'Authentication required');
}
async function authMiddleware(req, res, next) {
    try {
        const principal = await authenticateRequest(req);
        req.principal = principal;
        req.authContext = { principal };
        return next();
    }
    catch (err) {
        if (err instanceof AuthError) {
            return res.status(err.status).json({ error: err.code });
        }
        return next(err);
    }
}
function resetAuthCaches() {
    cachedConfig = null;
    cachedJwkResolver = null;
}
// Internal helpers exported for tests
exports.__testInternals = {
    loadOidcConfig,
    getJwkResolver,
};
