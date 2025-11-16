"use strict";
/**
 * memory-layer/service/audit/kmsAdapter.types.ts
 *
 * Small helper types and mappings for KMS signing algorithm names and
 * MessageType/MacAlgorithm constants used by @aws-sdk/client-kms.
 *
 * Purpose:
 *  - Centralize the canonical string names used against AWS KMS so we avoid
 *    scattering `'ED25519' as any` or similar casts across the codebase.
 *  - Provide a tiny helper to translate our normalized algorithm names
 *    (hmac-sha256, rsa-sha256, ed25519) into KMS SDK values.
 *
 * This file intentionally keeps types lightweight (strings) so it can be used
 * in both runtime and compile-time contexts without pulling heavy SDK types.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KMS_MESSAGE_TYPES = exports.KMS_ALGS = void 0;
exports.kmsParamsForAlg = kmsParamsForAlg;
exports.normalizeAlg = normalizeAlg;
/**
 * KMS MacAlgorithm / SigningAlgorithm / MessageType strings used by SDK.
 * These are string constants (not strict imports) to avoid a hard dependency
 * on the exact SDK enum type in every caller.
 */
exports.KMS_ALGS = {
    HMAC_SHA_256: 'HMAC_SHA_256',
    RSASSA_PKCS1_V1_5_SHA_256: 'RSASSA_PKCS1_V1_5_SHA_256',
    ED25519: 'ED25519'
};
exports.KMS_MESSAGE_TYPES = {
    DIGEST: 'DIGEST'
};
/**
 * Map our normalized alg -> KMS parameters:
 *  - macAlgorithm (for GenerateMac/VerifyMac)
 *  - signingAlgorithm (for Sign/Verify)
 *  - messageType (optional; use 'DIGEST' for digest-path RSA)
 */
function kmsParamsForAlg(alg) {
    const a = alg.toLowerCase();
    if (a === 'hmac-sha256' || a === 'hmac') {
        return {
            macAlgorithm: exports.KMS_ALGS.HMAC_SHA_256,
            signingAlgorithm: null,
            messageType: null
        };
    }
    if (a === 'rsa-sha256' || a === 'rsa') {
        return {
            macAlgorithm: null,
            signingAlgorithm: exports.KMS_ALGS.RSASSA_PKCS1_V1_5_SHA_256,
            messageType: exports.KMS_MESSAGE_TYPES.DIGEST
        };
    }
    if (a === 'ed25519' || a === 'ed25519-sha') {
        return {
            macAlgorithm: null,
            signingAlgorithm: exports.KMS_ALGS.ED25519,
            messageType: null
        };
    }
    // Fallback: treat as HMAC
    return {
        macAlgorithm: exports.KMS_ALGS.HMAC_SHA_256,
        signingAlgorithm: null,
        messageType: null
    };
}
/**
 * Convenience: given an environment variable value for AUDIT_SIGNING_ALG,
 * return a normalized value to pass to kmsParamsForAlg.
 */
function normalizeAlg(envAlg) {
    const raw = (envAlg ?? 'hmac-sha256').toLowerCase();
    if (raw.includes('hmac'))
        return 'hmac-sha256';
    if (raw.includes('rsa'))
        return 'rsa-sha256';
    if (raw.includes('ed25519') || raw.includes('ed25519-sha'))
        return 'ed25519';
    return 'hmac-sha256';
}
exports.default = {
    KMS_ALGS: exports.KMS_ALGS,
    KMS_MESSAGE_TYPES: exports.KMS_MESSAGE_TYPES,
    kmsParamsForAlg,
    normalizeAlg
};
