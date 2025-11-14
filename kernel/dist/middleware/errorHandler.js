"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const logger_1 = __importDefault(require("../logger"));
const isProduction = (process.env.NODE_ENV || '').toLowerCase() === 'production';
function mapStatus(code, fallback) {
    switch ((code || '').toLowerCase()) {
        case 'unauthenticated':
        case 'auth.required':
            return 401;
        case 'forbidden':
        case 'policy.denied':
            return 403;
        case 'validation_error':
        case 'invalid_request':
            return 400;
        case 'conflict':
        case 'idempotency_key_conflict':
            return 409;
        default:
            return fallback && fallback >= 400 ? fallback : 500;
    }
}
function errorHandler(err, _req, res, _next) {
    const code = err.code || (typeof err.message === 'string' ? err.message : undefined) || 'internal_error';
    const initialStatus = err.status ?? err.statusCode;
    const status = mapStatus(code, initialStatus);
    const details = err.details ?? err.errors;
    logger_1.default.error('request_failed', {
        code,
        status,
        message: err.message,
    });
    const body = {
        error: err.message || code,
        code,
    };
    if (details !== undefined) {
        body.details = details;
    }
    if (!isProduction && err.stack) {
        body.stack = err.stack.split('\n');
    }
    res.status(status).json(body);
}
exports.default = errorHandler;
