"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuthenticated = exports.hasRole = exports.Roles = void 0;
exports.getPrincipalFromRequest = getPrincipalFromRequest;
exports.hasAnyRole = hasAnyRole;
exports.requireRoles = requireRoles;
exports.requireAnyAuthenticated = requireAnyAuthenticated;
const logger_1 = require("./logger");
const rbac_1 = require("./middleware/rbac");
Object.defineProperty(exports, "hasRole", { enumerable: true, get: function () { return rbac_1.hasRole; } });
/**
 * Known roles (canonical)
 */
exports.Roles = rbac_1.Roles;
/**
 * Dynamic role-mapper loader
 *
 * We require it at runtime inside functions to avoid a static circular import
 * during module initialization (roleMapping may reference this module for types).
 */
function loadRoleMapper() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
        return require('./auth/roleMapping');
    }
    catch (e) {
        // Not present (or circular during early init); fall back to no-op mapper
        return null;
    }
}
/**
 * parseRolesHeader
 * Parse a comma / space separated roles header into a cleaned array.
 */
function parseRolesHeader(headerValue) {
    if (!headerValue)
        return [];
    return headerValue
        .split(/[,\s]+/)
        .map((r) => r.trim())
        .filter(Boolean);
}
/**
 * normalizeRoles
 * Use the roleMapping helper to map incoming role strings into canonical roles when available.
 */
function normalizeRoles(rawRoles) {
    const mapper = loadRoleMapper();
    if (mapper && typeof mapper.mapOidcRolesToCanonical === 'function') {
        try {
            return mapper.mapOidcRolesToCanonical(rawRoles);
        }
        catch (e) {
            // ignore mapper errors and fall back to raw roles
        }
    }
    // Default: return unique cleaned roles
    return Array.from(new Set(rawRoles));
}
/**
 * Try to parse a JWT payload **without verifying**. Used only as a dev/test fallback.
 * This decodes the middle JWT segment (payload) as base64url and parses JSON.
 */
function tryDecodeJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length < 2)
            return null;
        let b = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b.length % 4 !== 0)
            b += '=';
        const buf = Buffer.from(b, 'base64');
        const json = buf.toString('utf8');
        return JSON.parse(json);
    }
    catch {
        return null;
    }
}
/**
 * getPrincipalFromRequest
 *
 * Lightweight principal extractor for development and local testing.
 * Production: replace with proper OIDC token validation (extract roles from ID token or introspection)
 *           and mTLS cert mapping for service principals.
 *
 * Heuristics (dev/testing only):
 * - If header `x-oidc-claims` (JSON) present -> use principalFromOidcClaims(claims) if mapper available
 * - Else if header `x-oidc-sub` is present => human principal (roles from x-oidc-roles or x-roles)
 * - Else if header `x-service-id` present => service principal (roles from x-service-roles)
 * - Else try Authorization: Bearer <JWT> decode (dev/test fallback)
 * - Else fallback to anonymous principal
 *
 * NOTE: These headers are for development only and should not be trusted in production.
 */
function getPrincipalFromRequest(req) {
    const mapper = loadRoleMapper();
    // 1) If JSON claims provided, let the mapper parse them if available
    const claimsHeader = req.header('x-oidc-claims');
    if (claimsHeader && mapper && typeof mapper.principalFromOidcClaims === 'function') {
        try {
            const parsed = JSON.parse(claimsHeader);
            const p = mapper.principalFromOidcClaims(parsed);
            // ensure roles normalized
            p.roles = normalizeRoles(p.roles || []);
            return p;
        }
        catch (e) {
            // fall through to header parsing on JSON errors
        }
    }
    // 1.b) Authorization: Bearer <JWT> — test/dev fallback: decode payload without verifying.
    // This is intentionally permissive and only intended for local integration tests.
    const authHeader = (req.header('authorization') || req.header('Authorization') || '').toString();
    const m = authHeader.match(/^\s*Bearer\s+(.+)\s*$/i);
    if (m) {
        const token = m[1];
        const payload = tryDecodeJwtPayload(token);
        if (payload) {
            // If a mapper exists, prefer it to construct canonical principal
            if (mapper && typeof mapper.principalFromOidcClaims === 'function') {
                try {
                    const p = mapper.principalFromOidcClaims(payload);
                    p.roles = normalizeRoles(p.roles || []);
                    // Ensure id fallback
                    p.id = p.id || String(payload.sub || payload.sid || payload.subject || 'user.dev');
                    return p;
                }
                catch {
                    // fallthrough to basic payload extraction
                }
            }
            // Build minimal principal from payload
            const id = String(payload.sub || payload.sid || payload.subject || 'user.dev');
            let roles = [];
            if (payload?.realm_access && Array.isArray(payload.realm_access.roles))
                roles = roles.concat(payload.realm_access.roles);
            if (payload?.resource_access && typeof payload.resource_access === 'object') {
                for (const k of Object.keys(payload.resource_access || {})) {
                    const r = payload.resource_access[k]?.roles;
                    if (Array.isArray(r))
                        roles.push(...r);
                }
            }
            if (Array.isArray(payload?.roles))
                roles = roles.concat(payload.roles);
            if (typeof payload?.roles === 'string')
                roles = roles.concat(payload.roles.split(/[,\s]+/).filter(Boolean));
            if (typeof payload?.scope === 'string')
                roles = roles.concat(payload.scope.split(/\s+/).filter(Boolean));
            // normalize and return
            return { type: 'human', id, roles: normalizeRoles(roles) };
        }
    }
    // Human/OIDC-style headers (development-only)
    const oidcSub = req.header('x-oidc-sub') || req.header('x-user-id');
    const oidcRolesHeader = req.header('x-oidc-roles') || req.header('x-roles');
    if (oidcSub) {
        const parsed = parseRolesHeader(oidcRolesHeader);
        const roles = normalizeRoles(parsed);
        return { type: 'human', id: String(oidcSub), roles: roles.length ? roles : [] };
    }
    // NEW: tolerate `x-oidc-roles` alone (no subject) as a test/dev convenience.
    // Some tests set only roles header and expect /principal to return a principal with roles.
    if (!oidcSub && oidcRolesHeader) {
        const parsed = parseRolesHeader(oidcRolesHeader);
        const roles = normalizeRoles(parsed);
        // Use a stable dev id so tests asserting on principal shape get a reasonable id.
        return { type: 'human', id: 'user.dev', roles: roles.length ? roles : [] };
    }
    // Service / mTLS-style headers (development-only)
    const serviceId = req.header('x-service-id') || req.header('x-mtls-service');
    const serviceRoles = req.header('x-service-roles') || req.header('x-service-role');
    if (serviceId) {
        // if mapper offers principalFromCert and we have a cert header, try that path
        const certHeader = req.header('x-service-cert') || req.header('x-mtls-cert');
        if (certHeader && mapper && typeof mapper.principalFromCert === 'function') {
            try {
                // try parse as JSON cert shape or fallback to subject string
                let certObj = certHeader;
                try {
                    certObj = JSON.parse(certHeader);
                }
                catch (_) {
                    // leave as string
                }
                const p = mapper.principalFromCert(certObj);
                // prefer explicit serviceId header if provided
                p.id = p.id || serviceId;
                p.roles = normalizeRoles(p.roles || []);
                return p;
            }
            catch (e) {
                // ignore and fall back to header roles
            }
        }
        const parsed = parseRolesHeader(serviceRoles);
        const roles = normalizeRoles(parsed);
        return { type: 'service', id: serviceId, roles: roles.length ? roles : [] };
    }
    // Allow explicit "role override" for quick local testing (NOT for prod)
    const roleOverride = req.header('x-role-override');
    if (roleOverride) {
        const roles = normalizeRoles(parseRolesHeader(roleOverride));
        return { type: 'human', id: 'dev-override', roles };
    }
    return { type: 'anonymous', roles: [] };
}
function hasAnyRole(principal, required) {
    const requiredRoles = Array.isArray(required) ? required : [required];
    if (!requiredRoles.length)
        return true;
    return requiredRoles.some((role) => (0, rbac_1.hasRole)(principal, role));
}
function requireRoles(...requiredRoles) {
    return (req, res, next) => {
        try {
            let principal = req.principal;
            if (!principal) {
                principal = getPrincipalFromRequest(req);
                req.principal = principal;
            }
            const typedPrincipal = principal;
            if (!typedPrincipal || typedPrincipal.type === 'anonymous') {
                logger_1.logger.warn('rbac.unauthenticated', {
                    path: req.path,
                    method: req.method,
                    requiredRoles,
                });
                return res.status(401).json({ error: 'unauthenticated', requiredRoles });
            }
            if (!hasAnyRole(typedPrincipal, requiredRoles)) {
                logger_1.logger.warn('rbac.forbidden', {
                    path: req.path,
                    method: req.method,
                    principal: typedPrincipal.id,
                    requiredRoles,
                });
                return res.status(403).json({ error: 'forbidden', requiredRoles, required: requiredRoles });
            }
            return next();
        }
        catch (err) {
            logger_1.logger.warn('rbac.error', {
                path: req.path,
                method: req.method,
                error: err.message,
            });
            return res.status(500).json({ error: 'rbac.error' });
        }
    };
}
/**
 * requireAnyAuthenticated
 * Middleware which allows any authenticated principal (human or service), used for endpoints
 * that require authentication but no specific role.
 */
function requireAnyAuthenticated(req, res, next) {
    try {
        const principal = req.principal ?? getPrincipalFromRequest(req);
        req.principal = principal;
        if (!principal || principal.type === 'anonymous') {
            logger_1.logger.warn('rbac.unauthenticated', { path: req.path, method: req.method });
            return res.status(401).json({ error: 'unauthenticated' });
        }
        return next();
    }
    catch (err) {
        logger_1.logger.warn('rbac.error', { path: req.path, method: req.method, error: err.message });
        return res.status(500).json({ error: 'rbac.error' });
    }
}
exports.requireAuthenticated = rbac_1.requireAuthenticated;
/**
 * Example usage notes:
 *
 * - For division creation, require DivisionLead or SuperAdmin:
 *     app.post('/kernel/division', requireRoles(Roles.SUPERADMIN, Roles.DIVISION_LEAD), handler)
 *
 * - For audit reads, require Auditor or SuperAdmin:
 *     app.get('/kernel/audit/:id', requireRoles(Roles.AUDITOR, Roles.SUPERADMIN), handler)
 *
 * - For endpoints that accept either authenticated human or service principals,
 *   prefer `requireAnyAuthenticated`.
 *
 * Finally: this module is intentionally light-weight for local dev. Replace the
 * roleMapping & principal extraction with robust OIDC and mTLS verification in
 * production.
 */
