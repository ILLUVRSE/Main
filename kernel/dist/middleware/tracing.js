"use strict";
/**
 * kernel/src/middleware/tracing.ts
 *
 * Simple request tracing middleware that propagates or generates an
 * X-Trace-Id header and stores it in AsyncLocalStorage so downstream
 * components (logger, audit) can enrich events.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tracingMiddleware = tracingMiddleware;
exports.getCurrentTraceId = getCurrentTraceId;
const async_hooks_1 = require("async_hooks");
const crypto_1 = __importDefault(require("crypto"));
const storage = new async_hooks_1.AsyncLocalStorage();
const TRACE_HEADER = 'x-trace-id';
function sanitizeTraceId(value) {
    if (!value)
        return undefined;
    const trimmed = String(value).trim();
    if (!trimmed)
        return undefined;
    if (!/^[A-Za-z0-9\-:_]{6,128}$/.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}
function tracingMiddleware(req, res, next) {
    const incoming = sanitizeTraceId(req.header(TRACE_HEADER));
    const traceId = incoming || crypto_1.default.randomUUID();
    res.setHeader('X-Trace-Id', traceId);
    res.locals.traceId = traceId;
    storage.run({ traceId }, () => {
        next();
    });
}
function getCurrentTraceId() {
    return storage.getStore()?.traceId;
}
exports.default = tracingMiddleware;
