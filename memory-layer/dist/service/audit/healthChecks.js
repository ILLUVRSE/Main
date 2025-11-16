"use strict";
/**
 * memory-layer/service/audit/healthChecks.ts
 *
 * Health checks / diagnostics for audit signing subsystem.
 *
 * Exports:
 *  - checkKmsHealth(): Promise<{ healthy: boolean, details: Record<string, any> }>
 *  - checkSigningProxyHealth(): Promise<{ healthy: boolean, details: Record<string, any> }>
 *  - checkMockSignerHealth(): Promise<{ healthy: boolean, details: Record<string, any> }>
 *  - getAuditHealth(): Promise<{ healthy: boolean, details: { kms?:..., proxy?:..., mock?:... } }>
 *
 * Notes:
 *  - Robust: never throws, always returns structured status for callers to surface
 *    in readiness endpoints or CI diagnostics.
 *  - Uses @aws-sdk/client-kms DescribeKey to verify KMS key presence & reachability.
 *  - Uses node-fetch to probe the signing proxy URL (if configured).
 *  - Uses environment presence/format for mock signer health.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkKmsHealth = checkKmsHealth;
exports.checkSigningProxyHealth = checkSigningProxyHealth;
exports.checkMockSignerHealth = checkMockSignerHealth;
exports.getAuditHealth = getAuditHealth;
const client_kms_1 = require("@aws-sdk/client-kms");
const node_fetch_1 = __importDefault(require("node-fetch"));
const mockSigner_1 = __importDefault(require("./mockSigner"));
/**
 * Check AWS KMS health for AUDIT_SIGNING_KMS_KEY_ID (if configured).
 */
async function checkKmsHealth() {
    const keyId = process.env.AUDIT_SIGNING_KMS_KEY_ID || process.env.AUDIT_SIGNING_KMS_KEY;
    if (!keyId) {
        return { healthy: false, details: { configured: false, message: 'AUDIT_SIGNING_KMS_KEY_ID not set' } };
    }
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    const client = new client_kms_1.KMSClient({ region });
    try {
        const cmd = new client_kms_1.DescribeKeyCommand({ KeyId: keyId });
        const resp = await client.send(cmd);
        const keyState = (resp.KeyMetadata && (resp.KeyMetadata.KeyState || resp.KeyMetadata.KeyManager)) ?? null;
        return {
            healthy: true,
            details: {
                configured: true,
                keyId,
                keyState,
                keyMetadata: resp.KeyMetadata ?? null
            }
        };
    }
    catch (err) {
        return {
            healthy: false,
            details: {
                configured: true,
                keyId,
                error: err.message || String(err)
            }
        };
    }
}
/**
 * Check signing proxy health by issuing a GET to SIGNING_PROXY_URL (if configured).
 * Accepts any reachable response (2xx-4xx considered reachable); network errors are unhealthy.
 */
async function checkSigningProxyHealth() {
    const base = process.env.SIGNING_PROXY_URL;
    if (!base) {
        return { healthy: false, details: { configured: false, message: 'SIGNING_PROXY_URL not set' } };
    }
    try {
        // Try a simple GET to the base URL. Some proxies expose /health but we don't assume it.
        const url = base.endsWith('/') ? base : base + '/';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        let resp;
        try {
            resp = await (0, node_fetch_1.default)(url, { method: 'GET', signal: controller.signal });
        }
        finally {
            clearTimeout(timeoutId);
        }
        return {
            healthy: true,
            details: {
                configured: true,
                url,
                status: resp.status,
                statusText: resp.statusText
            }
        };
    }
    catch (err) {
        return {
            healthy: false,
            details: {
                configured: true,
                url: base,
                error: err.message || String(err)
            }
        };
    }
}
/**
 * Check mock signer health. In practice the mock signer is healthy if it's available and
 * the MOCK_AUDIT_SIGNING_KEY is present or fallback is acceptable for tests.
 */
async function checkMockSignerHealth() {
    try {
        // If MOCK_AUDIT_SIGNING_KEY is set we'll report configured=true, else we still accept default.
        const envKey = process.env.MOCK_AUDIT_SIGNING_KEY;
        // Do a small sign/verify roundtrip to ensure the mockSigner works at runtime.
        const canonical = 'health-check-canonical';
        const signResp = await mockSigner_1.default.signAuditCanonical(canonical);
        const digestBuf = Buffer.from(
        // compute digest to verify against (mockSigner signs digest of canonical)
        // This duplicates mockSigner behavior to produce the same digest for verify.
        require('crypto').createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex'), 'hex');
        const ok = await mockSigner_1.default.verifySignature(signResp.signature, digestBuf);
        return {
            healthy: ok,
            details: {
                configured: Boolean(envKey),
                usedFallbackKey: !Boolean(envKey),
                signerKid: signResp.kid,
                signerAlg: signResp.alg,
                verificationOk: ok
            }
        };
    }
    catch (err) {
        return {
            healthy: false,
            details: {
                configured: Boolean(process.env.MOCK_AUDIT_SIGNING_KEY),
                error: err.message || String(err)
            }
        };
    }
}
/**
 * Combined audit signing health - report all configured signers.
 * Decision logic:
 *  - If any of KMS/proxy/mock is healthy and configured, overall healthy true.
 *  - If none configured or all configured ones unhealthy, overall healthy false.
 */
async function getAuditHealth() {
    const kms = await checkKmsHealth();
    const proxy = await checkSigningProxyHealth();
    const mock = await checkMockSignerHealth();
    const configuredHealthy = [kms, proxy, mock].some((h) => h.healthy === true && (h.details?.configured !== false));
    // If none configured, mark not healthy (no signer available)
    const anyConfigured = [kms.details?.configured, proxy.details?.configured, mock.details?.configured].some(Boolean);
    const healthy = configuredHealthy || (!anyConfigured && false);
    return {
        healthy,
        details: { kms, proxy, mock }
    };
}
exports.default = {
    checkKmsHealth,
    checkSigningProxyHealth,
    checkMockSignerHealth,
    getAuditHealth
};
