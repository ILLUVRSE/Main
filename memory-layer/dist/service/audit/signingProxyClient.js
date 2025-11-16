"use strict";
/**
 * memory-layer/service/audit/signingProxyClient.ts
 *
 * Thin HTTP client for a remote signing proxy. This module intentionally
 * avoids ESM-only dependencies and uses the Node http/https APIs for max compatibility.
 *
 * Expected proxy endpoints (JSON):
 *  POST /sign/canonical   { canonical: string } -> { kid, alg, signature }
 *  POST /sign/hash        { digest_hex: string } -> { kid, alg, signature }
 *  POST /verify           { digest_hex: string, signature: string } -> { valid: boolean }
 *
 * Environment:
 *  - SIGNING_PROXY_URL        (required to enable this client, e.g. https://signer.example.local)
 *  - SIGNING_PROXY_API_KEY    (optional, sent as Authorization: Bearer <key>)
 *
 * Use:
 *  - signAuditCanonical(canonical)
 *  - signAuditHash(digestBuf)
 *  - verifySignature(signatureBase64, digestBuf)
 *
 * Notes:
 *  - Request/response JSON is assumed. Throws on HTTP errors.
 *  - Timeout defaults are conservative (30s).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signAuditCanonical = signAuditCanonical;
exports.signAuditHash = signAuditHash;
exports.verifySignature = verifySignature;
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
const node_url_1 = require("node:url");
const buffer_1 = require("buffer");
const proxyUrl = (process.env.SIGNING_PROXY_URL || '').trim();
const proxyApiKey = process.env.SIGNING_PROXY_API_KEY ?? undefined;
if (!proxyUrl) {
    // module can still be imported; calls will throw if used and no proxy configured.
}
/** Generic POST JSON helper using node http/https */
async function postJson(path, body, timeoutMs = 30000) {
    if (!proxyUrl)
        throw new Error('SIGNING_PROXY_URL is not configured');
    const base = new node_url_1.URL(proxyUrl);
    // Build full URL (preserve path)
    const full = new node_url_1.URL(path.startsWith('/') ? path : `/${path}`, base).toString();
    const parsed = new node_url_1.URL(full);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? node_https_1.default : node_http_1.default;
    const json = JSON.stringify(body);
    const opts = {
        method: 'POST',
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : undefined,
        path: parsed.pathname + (parsed.search ?? ''),
        headers: {
            'content-type': 'application/json',
            'content-length': buffer_1.Buffer.byteLength(json),
            accept: 'application/json'
        },
        timeout: timeoutMs
    };
    if (proxyApiKey) {
        opts.headers['authorization'] = `Bearer ${proxyApiKey}`;
    }
    return new Promise((resolve, reject) => {
        const req = lib.request(opts, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                const status = res.statusCode ?? 0;
                if (status < 200 || status >= 300) {
                    const msg = `signing-proxy ${parsed.pathname} responded ${status}: ${data}`;
                    return reject(new Error(msg));
                }
                try {
                    const parsedJson = data ? JSON.parse(data) : {};
                    resolve(parsedJson);
                }
                catch (err) {
                    reject(new Error(`invalid json from signing-proxy: ${err.message}`));
                }
            });
        });
        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy(new Error('request timed out'));
        });
        req.write(json);
        req.end();
    });
}
/** Sign canonical payload (message path) */
async function signAuditCanonical(canonical) {
    if (!canonical)
        throw new Error('canonical required');
    const resp = await postJson('/sign/canonical', { canonical });
    if (!resp || !resp.signature)
        throw new Error('signing proxy returned no signature');
    return resp;
}
/** Sign precomputed digest (digestBuf) - returns kid/alg/signature */
async function signAuditHash(digestBuf) {
    if (!buffer_1.Buffer.isBuffer(digestBuf))
        throw new Error('digestBuf must be a Buffer');
    const digestHex = digestBuf.toString('hex');
    const resp = await postJson('/sign/hash', { digest_hex: digestHex });
    if (!resp || !resp.signature)
        throw new Error('signing proxy returned no signature');
    return resp;
}
/** Verify a signature against a digest buffer using the proxy */
async function verifySignature(signatureBase64, digestBuf) {
    if (!signatureBase64)
        throw new Error('signature required');
    if (!buffer_1.Buffer.isBuffer(digestBuf))
        throw new Error('digestBuf must be a Buffer');
    const digestHex = digestBuf.toString('hex');
    const resp = await postJson('/verify', { digest_hex: digestHex, signature: signatureBase64 });
    return Boolean(resp?.valid);
}
exports.default = {
    signAuditCanonical,
    signAuditHash,
    verifySignature
};
