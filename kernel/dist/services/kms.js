"use strict";
/**
 * kernel/src/services/kms.ts
 *
 * Lightweight helpers for interacting with the configured KMS endpoint.
 * The Kernel only needs the ability to probe reachability for health/readiness
 * checks, so the helper intentionally stays small and dependency-free.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeKmsReachable = probeKmsReachable;
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
/**
 * probeKmsReachable performs a simple HTTP GET against the provided endpoint
 * and resolves to `true` if the TCP connection succeeds and a response is
 * received before the timeout. Any network or protocol error results in
 * `false` so callers can surface KMS reachability in health checks.
 */
async function probeKmsReachable(endpoint, timeoutMs = 3000) {
    const url = (endpoint || '').trim();
    if (!url) {
        return false;
    }
    try {
        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https_1.default : http_1.default;
        return await new Promise((resolve) => {
            const opts = {
                hostname: parsed.hostname,
                port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
                path: (parsed.pathname || '/') + (parsed.search || ''),
                method: 'GET',
                timeout: timeoutMs,
            };
            const req = lib.request(opts, (res) => {
                res.on('data', () => { });
                res.on('end', () => resolve(true));
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                try {
                    req.destroy();
                }
                catch {
                    // ignore
                }
                resolve(false);
            });
            req.end();
        });
    }
    catch {
        return false;
    }
}
exports.default = probeKmsReachable;
