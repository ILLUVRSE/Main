"use strict";
/**
 * kernel/src/logger.ts
 *
 * Structured logger emitting JSON lines for ingestion by log processors.
 * Audit events include the active traceId when available so audit streams can
 * be correlated with request traces.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
function nowIso() {
    return new Date().toISOString();
}
function resolveTraceId(meta) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const tracing = require('./middleware/tracing');
        if (typeof tracing.getCurrentTraceId === 'function') {
            return meta?.traceId || tracing.getCurrentTraceId() || undefined;
        }
    }
    catch {
        // ignore lazy require failures in environments that do not load middleware
    }
    return meta?.traceId || undefined;
}
function emitConsole(level, entry) {
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
    // eslint-disable-next-line no-console
    console[method](JSON.stringify(entry));
}
function log(level, message, meta) {
    const { traceId: _unused, ...rest } = meta || {};
    const traceId = resolveTraceId(meta);
    const entry = {
        level,
        timestamp: nowIso(),
        message,
        traceId: level === 'audit' ? traceId || 'unknown' : traceId,
        ...rest,
    };
    if (level === 'audit') {
        entry.event = message;
        entry.category = 'audit';
        emitConsole('info', entry);
        return;
    }
    emitConsole(level, entry);
}
exports.logger = {
    info(message, meta) {
        log('info', message, meta);
    },
    warn(message, meta) {
        log('warn', message, meta);
    },
    error(message, meta) {
        log('error', message, meta);
    },
    audit(event, meta) {
        log('audit', event, meta);
    },
};
exports.default = exports.logger;
