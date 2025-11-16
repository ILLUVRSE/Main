"use strict";
/**
 * memory-layer/service/middleware/auth.ts
 *
 * Lightweight auth middleware for Memory Layer that is self-contained and
 * type-compatible with express RequestHandler signatures used by server.ts.
 *
 * Goals:
 *  - Provide `authMiddleware` that populates `req.principal` from a safe dev header
 *    (`X-Local-Dev-Principal`) OR (optionally) from Authorization Bearer tokens.
 *  - Provide helpers `requireScopes`, `hasScope`, and `MemoryScopes` for route-level checks.
 *  - Be strongly typed so `app.use('/v1', authMiddleware, ...)` does not require casting.
 *
 * Note: This implementation intentionally keeps auth simple for local/CI/dev.
 * In production you should replace the token parsing / verification with your
 * real OIDC/JWKS verification and map claims => principal.roles properly.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = exports.MemoryScopes = void 0;
exports.hasScope = hasScope;
exports.requireScopes = requireScopes;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
/**
 * Memory-layer well-known scope constants.
 */
exports.MemoryScopes = {
    WRITE: 'memory:write',
    READ: 'memory:read',
    READ_PII: 'read:pii',
    LEGAL_HOLD: 'memory:legal_hold',
    ADMIN: 'admin'
};
/**
 * Parse X-Local-Dev-Principal header (JSON string).
 * Example header:
 *   X-Local-Dev-Principal: {"id":"test-service","type":"service","roles":["memory:write","memory:read","read:pii"]}
 *
 * This header is only intended for local development and CI. It must be enabled
 * by operator convention; do not rely on it in production.
 */
function parseLocalDevPrincipal(header) {
    if (!header)
        return null;
    const raw = Array.isArray(header) ? header[0] : header;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return null;
        const id = String(parsed.id ?? 'local-dev');
        const type = parsed.type ?? 'service';
        const roles = Array.isArray(parsed.roles) ? parsed.roles.map(String) : [];
        return { id, type, roles, claims: parsed };
    }
    catch {
        return null;
    }
}
/**
 * Minimal JWT-based principal extraction (optional).
 * If JWT verification is required, configure SIGNING_JWT_PUBLIC_KEY or set JWT_SECRET env.
 *
 * This is intentionally permissive for dev; replace verification logic with OIDC/JWKS in production.
 */
function extractPrincipalFromBearer(token) {
    if (!token)
        return null;
    try {
        // Allow either raw token or "Bearer <token>"
        const raw = token.startsWith('Bearer ') ? token.split(/\s+/)[1] : token;
        // If a JWT public key is configured, attempt to verify; else decode without verifying.
        const jwtPublic = process.env.JWT_PUBLIC_KEY;
        const jwtSecret = process.env.JWT_SECRET; // fallback symmetric secret (dev)
        let payload;
        if (jwtPublic) {
            payload = jsonwebtoken_1.default.verify(raw, jwtPublic, { algorithms: ['RS256', 'ES256', 'ES384', 'ES512'] });
        }
        else if (jwtSecret) {
            payload = jsonwebtoken_1.default.verify(raw, jwtSecret);
        }
        else {
            // decode without verify for convenience (not recommended in prod)
            payload = jsonwebtoken_1.default.decode(raw);
        }
        if (!payload || typeof payload !== 'object')
            return null;
        // Map common claim names to principal
        const sub = payload.sub ?? payload.client_id ?? 'jwt-sub';
        const typ = payload.typ ?? payload.token_type ?? 'user';
        // roles may be in 'roles', 'scope' (space-separated), or 'scopes'
        let roles = [];
        if (Array.isArray(payload.roles))
            roles = payload.roles.map(String);
        else if (typeof payload.scope === 'string')
            roles = payload.scope.split(/\s+/);
        else if (typeof payload.scopes === 'string')
            roles = payload.scopes.split(/\s+/);
        return { id: String(sub), type: typ, roles, claims: payload };
    }
    catch {
        // On any token error, return null (treat as unauthenticated)
        return null;
    }
}
/**
 * Main auth middleware that populates req.principal if possible.
 * Does not reject requests by default; route-level guards enforce scope.
 */
const authMiddleware = (req, _res, next) => {
    try {
        // 1) Prefer local-dev header (useful for CI/dev)
        const localHeader = req.header('x-local-dev-principal') ?? req.header('X-Local-Dev-Principal');
        const devPrincipal = parseLocalDevPrincipal(localHeader ?? undefined);
        if (devPrincipal) {
            req.principal = devPrincipal;
            return next();
        }
        // 2) Try Authorization Bearer
        const authHeader = req.header('authorization') ?? req.header('Authorization');
        if (authHeader) {
            const principal = extractPrincipalFromBearer(authHeader);
            if (principal) {
                req.principal = principal;
                return next();
            }
        }
        // 3) No principal found: set an anonymous principal with no roles
        req.principal = { id: 'anonymous', type: 'anonymous', roles: [] };
        return next();
    }
    catch (err) {
        // On unexpected error, set anonymous and continue (route-level can reject)
        req.principal = { id: 'anonymous', type: 'anonymous', roles: [] };
        return next();
    }
};
exports.authMiddleware = authMiddleware;
/**
 * Helper: return true if principal has the given scope
 */
function hasScope(principal, scope) {
    if (!principal)
        return false;
    const roles = principal.roles ?? [];
    return roles.includes(scope);
}
/**
 * requireScopes: middleware factory to enforce scopes.
 *
 * Accepts either:
 *  - a single scope string, or
 *  - an object { anyOf: string[] } to allow any of the scopes,
 *  - or an object { allOf: string[] } to require all scopes.
 *
 * Example:
 *   requireScopes(MemoryScopes.WRITE)
 *   requireScopes({ anyOf: [MemoryScopes.LEGAL_HOLD, MemoryScopes.ADMIN] })
 */
function requireScopes(spec) {
    return (req, res, next) => {
        const principal = req.principal;
        if (!principal) {
            res.status(401).json({ error: { message: 'unauthenticated' } });
            return;
        }
        if (typeof spec === 'string') {
            if (!hasScope(principal, spec)) {
                res.status(403).json({ error: { message: 'forbidden: missing scope' } });
                return;
            }
            return next();
        }
        if (spec.anyOf && Array.isArray(spec.anyOf)) {
            const ok = spec.anyOf.some((s) => hasScope(principal, s));
            if (!ok) {
                res.status(403).json({ error: { message: 'forbidden: requires one of the scopes' } });
                return;
            }
            return next();
        }
        if (spec.allOf && Array.isArray(spec.allOf)) {
            const ok = spec.allOf.every((s) => hasScope(principal, s));
            if (!ok) {
                res.status(403).json({ error: { message: 'forbidden: requires all scopes' } });
                return;
            }
            return next();
        }
        // default deny
        res.status(403).json({ error: { message: 'forbidden' } });
    };
}
exports.default = {
    authMiddleware: exports.authMiddleware,
    requireScopes,
    hasScope,
    MemoryScopes: exports.MemoryScopes
};
