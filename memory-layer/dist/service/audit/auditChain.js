"use strict";
/**
 * memory-layer/service/audit/auditChain.ts
 *
 * Canonicalization, digest computation, and audit signing utilities.
 *
 * Exports:
 *  - canonicalizePayload(value: unknown): string
 *  - computeAuditDigest(canonicalPayload: string, prevHashHex: string | null): string
 *  - signAuditDigest(digestHex: string): Promise<string | null>   // preferred async signer
 *  - signAuditDigestSync(digestHex: string): string | null       // synchronous fallback (local-key)
 *  - verifySignature(signatureBase64: string, digestBuf: Buffer): Promise<boolean>
 *
 * Behavior:
 *  - Prefer KMS adapter if AUDIT_SIGNING_KMS_KEY_ID configured.
 *  - Else prefer signing proxy if SIGNING_PROXY_URL configured.
 *  - Else (dev/CI) prefer mock signer if MOCK_AUDIT_SIGNING_KEY or NODE_ENV=development.
 *  - Else fall back to local key / secret (AUDIT_SIGNING_KEY / AUDIT_SIGNING_SECRET / AUDIT_SIGNING_PRIVATE_KEY).
 *  - In production callers should ensure signing is available (server startup enforces REQUIRE_KMS).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeAuditDigest = exports.canonicalizePayload = void 0;
exports.signAuditDigest = signAuditDigest;
exports.signAuditDigestSync = signAuditDigestSync;
exports.verifySignature = verifySignature;
const node_crypto_1 = __importDefault(require("node:crypto"));
const buffer_1 = require("buffer");
const kmsAdapter = __importStar(require("./kmsAdapter"));
const signingProxyClient_1 = __importDefault(require("./signingProxyClient"));
const mockSigner_1 = __importDefault(require("./mockSigner"));
const DEFAULT_ALG = 'hmac-sha256';
/**
 * Canonicalize payload deterministically for audit digest.
 * Sorted keys, JSON-escaped strings; mirrors prior canonicalization.
 */
const canonicalizePayload = (value) => {
    if (value === null || value === undefined)
        return 'null';
    if (Array.isArray(value)) {
        return `[${value.map((entry) => (0, exports.canonicalizePayload)(entry)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, entry]) => `${JSON.stringify(key)}:${(0, exports.canonicalizePayload)(entry)}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
};
exports.canonicalizePayload = canonicalizePayload;
/**
 * Compute audit digest: SHA-256 over canonical payload bytes followed by prevHash bytes (if any).
 * Returns hex string lowercase.
 */
const computeAuditDigest = (canonicalPayload, prevHashHex) => {
    const canonicalBuffer = buffer_1.Buffer.from(canonicalPayload, 'utf8');
    const prevBuffer = prevHashHex ? buffer_1.Buffer.from(prevHashHex, 'hex') : buffer_1.Buffer.alloc(0);
    return node_crypto_1.default.createHash('sha256').update(buffer_1.Buffer.concat([canonicalBuffer, prevBuffer])).digest('hex');
};
exports.computeAuditDigest = computeAuditDigest;
/**
 * Async signing of a precomputed digest (hex string).
 * Preferred API for production (supports KMS / signing proxy / mockSigner / local keys).
 * Returns base64 signature string, or `null` if no signer is configured (caller may decide behavior).
 */
async function signAuditDigest(digestHex) {
    if (!digestHex || typeof digestHex !== 'string') {
        throw new Error('digestHex (hex string) is required');
    }
    const digestBuf = buffer_1.Buffer.from(digestHex, 'hex');
    // 1) Prefer KMS adapter if configured
    const kmsConfigured = Boolean(process.env.AUDIT_SIGNING_KMS_KEY_ID || process.env.AUDIT_SIGNING_KMS_KEY);
    if (kmsConfigured) {
        try {
            const resp = await kmsAdapter.signAuditHash(digestBuf);
            if (!resp || !resp.signature)
                throw new Error('KMS adapter returned no signature');
            return resp.signature;
        }
        catch (err) {
            throw new Error(`KMS signing failed: ${err.message || String(err)}`);
        }
    }
    // 2) Signing proxy (optional)
    if (process.env.SIGNING_PROXY_URL) {
        try {
            const resp = await signingProxyClient_1.default.signAuditHash(digestBuf);
            if (!resp || !resp.signature)
                throw new Error('signing proxy returned no signature');
            return resp.signature;
        }
        catch (err) {
            throw new Error(`signing proxy failed: ${err.message || String(err)}`);
        }
    }
    // 3) Mock signer for dev / CI
    const mockConfigured = Boolean(process.env.MOCK_AUDIT_SIGNING_KEY) || (process.env.NODE_ENV ?? '').toLowerCase() === 'development';
    if (mockConfigured) {
        try {
            const resp = await mockSigner_1.default.signAuditHash(digestBuf);
            if (!resp || !resp.signature)
                throw new Error('mock signer returned no signature');
            return resp.signature;
        }
        catch (err) {
            throw new Error(`mock signer failed: ${err.message || String(err)}`);
        }
    }
    // 4) Local key / secret fallback (synchronous)
    return signAuditDigestSync(digestHex);
}
/**
 * Synchronous signing fallback using local env keys.
 * Returns base64 signature string or null if no local key available.
 *
 * NOTE: production should not rely on this; prefer KMS. In production an absent local key should be treated as error.
 */
function signAuditDigestSync(digestHex) {
    const signingKey = process.env.AUDIT_SIGNING_KEY ?? process.env.AUDIT_SIGNING_SECRET ?? process.env.AUDIT_SIGNING_PRIVATE_KEY ?? null;
    if (!signingKey) {
        return null;
    }
    const algorithm = (process.env.AUDIT_SIGNING_ALG ?? DEFAULT_ALG).toLowerCase();
    const digestBuffer = buffer_1.Buffer.from(digestHex, 'hex');
    if (algorithm === 'hmac-sha256' || algorithm === 'hmac') {
        return node_crypto_1.default.createHmac('sha256', signingKey).update(digestBuffer).digest('base64');
    }
    if (algorithm === 'ed25519') {
        try {
            return node_crypto_1.default.sign(null, digestBuffer, signingKey).toString('base64');
        }
        catch (err) {
            throw new Error(`ed25519 signing failed: ${err.message || String(err)}`);
        }
    }
    if (algorithm === 'rsa' || algorithm === 'rsa-sha256') {
        const DIGEST_PREFIX = buffer_1.Buffer.from('3031300d060960864801650304020105000420', 'hex'); // ASN.1 prefix for SHA-256
        const toSign = buffer_1.Buffer.concat([DIGEST_PREFIX, digestBuffer]);
        try {
            return node_crypto_1.default.privateEncrypt({
                key: signingKey,
                padding: node_crypto_1.default.constants.RSA_PKCS1_PADDING
            }, toSign).toString('base64');
        }
        catch (err) {
            throw new Error(`rsa signing failed: ${err.message || String(err)}`);
        }
    }
    // Fallback deterministic HMAC so we always produce something when key exists.
    return node_crypto_1.default.createHmac('sha256', signingKey).update(digestBuffer).digest('base64');
}
/**
 * Verify signature over a precomputed digest buffer.
 * Prefers KMS verify when configured; falls back to signing proxy, mock, and local verification.
 */
async function verifySignature(signatureBase64, digestBuf) {
    if (!buffer_1.Buffer.isBuffer(digestBuf))
        throw new Error('digestBuf must be a Buffer');
    if (!signatureBase64)
        throw new Error('signatureBase64 is required');
    // 1) KMS verify when configured
    const kmsConfigured = Boolean(process.env.AUDIT_SIGNING_KMS_KEY_ID || process.env.AUDIT_SIGNING_KMS_KEY);
    if (kmsConfigured) {
        try {
            return await kmsAdapter.verifySignature(signatureBase64, digestBuf);
        }
        catch (err) {
            throw new Error(`KMS verify failed: ${err.message || String(err)}`);
        }
    }
    // 2) Signing proxy verify
    if (process.env.SIGNING_PROXY_URL) {
        try {
            return await signingProxyClient_1.default.verifySignature(signatureBase64, digestBuf);
        }
        catch (err) {
            throw new Error(`signing proxy verify failed: ${err.message || String(err)}`);
        }
    }
    // 3) Mock signer verify (dev/CI)
    const mockConfigured = Boolean(process.env.MOCK_AUDIT_SIGNING_KEY) || (process.env.NODE_ENV ?? '').toLowerCase() === 'development';
    if (mockConfigured) {
        try {
            return await mockSigner_1.default.verifySignature(signatureBase64, digestBuf);
        }
        catch (err) {
            throw new Error(`mock signer verify failed: ${err.message || String(err)}`);
        }
    }
    // 4) Local verification fallback: assume HMAC or RSA/ED25519 based on AUDIT_SIGNING_ALG.
    const algorithm = (process.env.AUDIT_SIGNING_ALG ?? DEFAULT_ALG).toLowerCase();
    const sigBuf = buffer_1.Buffer.from(signatureBase64, 'base64');
    if (algorithm === 'hmac-sha256' || algorithm === 'hmac') {
        const signingKey = process.env.AUDIT_SIGNING_KEY ?? process.env.AUDIT_SIGNING_SECRET ?? null;
        if (!signingKey)
            throw new Error('local signing key not configured for HMAC verification');
        const expected = node_crypto_1.default.createHmac('sha256', signingKey).update(digestBuf).digest();
        return node_crypto_1.default.timingSafeEqual(expected, sigBuf);
    }
    if (algorithm === 'rsa' || algorithm === 'rsa-sha256') {
        const pubKey = process.env.AUDIT_SIGNING_PUBLIC_KEY ?? null;
        if (!pubKey)
            throw new Error('AUDIT_SIGNING_PUBLIC_KEY required for rsa verification');
        try {
            const ok = node_crypto_1.default.verify('sha256', digestBuf, pubKey, sigBuf);
            return Boolean(ok);
        }
        catch (err) {
            throw new Error(`rsa verify failed: ${err.message || String(err)}`);
        }
    }
    if (algorithm === 'ed25519') {
        const pubKey = process.env.AUDIT_SIGNING_PUBLIC_KEY ?? null;
        if (!pubKey)
            throw new Error('AUDIT_SIGNING_PUBLIC_KEY required for ed25519 verification');
        try {
            const ok = node_crypto_1.default.verify(null, digestBuf, pubKey, sigBuf);
            return Boolean(ok);
        }
        catch (err) {
            throw new Error(`ed25519 verify failed: ${err.message || String(err)}`);
        }
    }
    throw new Error(`Unsupported AUDIT_SIGNING_ALG for verify: ${algorithm}`);
}
exports.default = {
    canonicalizePayload: exports.canonicalizePayload,
    computeAuditDigest: exports.computeAuditDigest,
    signAuditDigest,
    signAuditDigestSync,
    verifySignature
};
