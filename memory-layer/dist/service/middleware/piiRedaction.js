"use strict";
/**
 * memory-layer/service/middleware/piiRedaction.ts
 *
 * PII redaction middleware and helpers.
 *
 * Behavior:
 *  - If principal has the read:pii scope, responses are passed through unchanged.
 *  - Otherwise, removes `piiFlags` / `pii_flags` fields and any nested occurrences.
 *  - Applies to JSON responses produced by res.json(...) and JSON strings sent via res.send(...).
 *
 * Safety:
 *  - Middleware is defensive: it never throws; in failure cases it leaves the body unchanged.
 *  - Does not attempt to detect or redact arbitrary PII values (only the structured `piiFlags` markers).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.piiRedactionMiddleware = exports.redactPayloadIfNeeded = exports.canReadPii = void 0;
exports.stripPiiFlags = stripPiiFlags;
const auth_1 = require("./auth");
/**
 * Return true if principal can read PII.
 */
const canReadPii = (principal) => (0, auth_1.hasScope)(principal, auth_1.MemoryScopes.READ_PII);
exports.canReadPii = canReadPii;
/**
 * Determine whether an object is a plain object suitable for recursion.
 */
const isPlainObject = (value) => {
    if (!value || typeof value !== 'object')
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
};
/**
 * Deep clone and strip PII flags recursively.
 * Replaces any property named `piiFlags`, `pii_flags`, or `pii` (case-insensitive) with an empty object.
 */
function stripPiiFlags(value) {
    try {
        if (Array.isArray(value)) {
            return value.map((item) => stripPiiFlags(item));
        }
        if (!isPlainObject(value)) {
            return value;
        }
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            const lower = k.toLowerCase();
            if (lower === 'piiflags' || lower === 'pii_flags' || lower === 'pii') {
                // preserve key but zero out PII flags object
                out[k] = {};
                continue;
            }
            // Recurse into objects/arrays
            if (Array.isArray(v)) {
                out[k] = v.map((item) => stripPiiFlags(item));
            }
            else if (isPlainObject(v)) {
                out[k] = stripPiiFlags(v);
            }
            else {
                out[k] = v;
            }
        }
        return out;
    }
    catch (err) {
        // Fail-open: on error, return original value (do not throw from middleware)
        // eslint-disable-next-line no-console
        console.error('[piiRedaction] stripPiiFlags error:', err.message || err);
        return value;
    }
}
/**
 * Convenience to redact a response payload if principal lacks READ_PII scope.
 */
const redactPayloadIfNeeded = (payload, principal) => {
    try {
        if ((0, exports.canReadPii)(principal))
            return payload;
        return stripPiiFlags(payload);
    }
    catch {
        return payload;
    }
};
exports.redactPayloadIfNeeded = redactPayloadIfNeeded;
/**
 * Express middleware: override res.json and res.send to redact PII flags for unauthorized principals.
 */
const piiRedactionMiddleware = (req, res, next) => {
    const principal = req.principal;
    if ((0, exports.canReadPii)(principal)) {
        // authorized to view PII — no-op
        next();
        return;
    }
    // Preserve originals
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    // Override res.json(body)
    res.json = ((body) => {
        try {
            const redacted = stripPiiFlags(body);
            return originalJson(redacted);
        }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error('[piiRedaction] res.json redaction failed:', err.message || err);
            return originalJson(body);
        }
    });
    // Override res.send for JSON-like strings and objects
    res.send = ((body) => {
        try {
            if (typeof body === 'string') {
                const trimmed = body.trim();
                if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                    try {
                        const parsed = JSON.parse(body);
                        const redacted = stripPiiFlags(parsed);
                        return originalSend(JSON.stringify(redacted));
                    }
                    catch {
                        return originalSend(body);
                    }
                }
                return originalSend(body);
            }
            if (Array.isArray(body) || isPlainObject(body)) {
                const redacted = stripPiiFlags(body);
                return originalSend(redacted);
            }
            return originalSend(body);
        }
        catch (err) {
            // eslint-disable-next-line no-console
            console.error('[piiRedaction] res.send redaction failed:', err.message || err);
            return originalSend(body);
        }
    });
    next();
};
exports.piiRedactionMiddleware = piiRedactionMiddleware;
exports.default = {
    canReadPii: exports.canReadPii,
    stripPiiFlags,
    redactPayloadIfNeeded: exports.redactPayloadIfNeeded,
    piiRedactionMiddleware: exports.piiRedactionMiddleware
};
