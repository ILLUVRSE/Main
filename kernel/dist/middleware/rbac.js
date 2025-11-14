"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Roles = void 0;
exports.normalizeRole = normalizeRole;
exports.hasRole = hasRole;
exports.hasAnyRole = hasAnyRole;
exports.requireAuthenticated = requireAuthenticated;
exports.requireRoles = requireRoles;
exports.enforceRoles = enforceRoles;
const logger_1 = require("../logger");
exports.Roles = {
    SUPERADMIN: 'SuperAdmin',
    DIVISION_LEAD: 'DivisionLead',
    OPERATOR: 'Operator',
    AUDITOR: 'Auditor',
};
function normalizeRole(role) {
    if (role === null || role === undefined)
        return '';
    const value = typeof role === 'string' ? role : String(role);
    return value.trim().toLowerCase();
}
function hasRole(user, role) {
    const target = normalizeRole(role);
    if (!target)
        return false;
    if (!user || !Array.isArray(user.roles))
        return false;
    return user.roles.some((candidate) => normalizeRole(candidate) === target);
}
function hasAnyRole(user, required) {
    const requiredRoles = Array.isArray(required) ? required : [required];
    if (!requiredRoles.length)
        return true;
    return requiredRoles.some((role) => hasRole(user, role));
}
function requireAuthenticated(req, res, next) {
    const principal = req.principal;
    if (!principal) {
        logger_1.logger.warn('rbac.unauthenticated', { path: req.path, method: req.method });
        return res.status(401).json({ error: 'unauthenticated' });
    }
    return next();
}
function requireRoles(...requiredRoles) {
    return (req, res, next) => {
        const principal = req.principal;
        if (!principal) {
            logger_1.logger.warn('rbac.unauthenticated', {
                path: req.path,
                method: req.method,
                requiredRoles,
            });
            return res.status(401).json({ error: 'unauthenticated', requiredRoles });
        }
        if (!hasAnyRole(principal, requiredRoles)) {
            logger_1.logger.warn('rbac.forbidden', {
                path: req.path,
                method: req.method,
                principal: principal?.id,
                requiredRoles,
            });
            return res
                .status(403)
                .json({ error: 'forbidden', requiredRoles, required: requiredRoles });
        }
        return next();
    };
}
function enforceRoles(principal, roles) {
    if (!principal) {
        throw new Error('unauthenticated');
    }
    if (!hasAnyRole(principal, roles)) {
        throw new Error('forbidden');
    }
}
exports.default = {
    Roles: exports.Roles,
    hasRole,
    hasAnyRole,
    requireRoles,
    requireAuthenticated,
    enforceRoles,
};
