"use strict";
/**
 * memory-layer/service/audit/multisig.ts
 *
 * Simple 3-of-5 (configurable N-of-M) multisig coordinator for signing digests.
 *
 * Purpose:
 *  - Coordinate signing of a precomputed digest (hex or Buffer) across multiple signers.
 *  - Collect signatures and produce a combined proof object that can be verified.
 *
 * Signer specification:
 *  - "mock"                          -> uses mockSigner (test/dev).
 *  - "proxy:<url>"                   -> uses signing proxy client at SIGNING_PROXY_URL if provided, or direct URL.
 *  - "kms:<keyId>"                   -> uses AWS KMS Sign/GenerateMac with the provided KeyId.
 *
 * Usage (CLI):
 *   npx ts-node memory-layer/service/audit/multisig.ts \
 *      --specs=mock,kms:arn:aws:kms:...:key/xxx,proxy:http://signer.local \
 *      --digest=deadbeef... \
 *      --threshold=3
 *
 * Output:
 *  - JSON with { digest, threshold, requestedAt, signatures: [{ signerId, kid, alg, signature }], okCount }
 *
 * Verification helper:
 *  - MultiSigCoordinator.verifyCombinedProof(proof) returns { ok: boolean, validCount: number, errors: [] }
 *
 * Notes:
 *  - This is an orchestration helper and NOT a cryptographic threshold signature scheme.
 *    It simply collects independent signatures and verifies at least `threshold` are valid.
 *  - For true threshold cryptography (single compact signature), integrate a proper threshold scheme.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiSigCoordinator = void 0;
exports.createSignerFromSpec = createSignerFromSpec;
const client_kms_1 = require("@aws-sdk/client-kms");
const signingProxyClient_1 = __importDefault(require("./signingProxyClient"));
const mockSigner_1 = __importDefault(require("./mockSigner"));
const buffer_1 = require("buffer");
/* -------------------------
   Signer implementations
   ------------------------- */
/** Mock signer wrapper */
class MockSignerClient {
    constructor(id = 'mock') {
        this.id = id;
    }
    async sign(digestBuf) {
        return mockSigner_1.default.signAuditHash(digestBuf);
    }
    async verify(signatureBase64, digestBuf) {
        return mockSigner_1.default.verifySignature(signatureBase64, digestBuf);
    }
}
/** Proxy signer wrapper (uses memory-layer/service/audit/signingProxyClient.ts) */
class ProxySignerClient {
    // baseUrl unused since signingProxyClient reads SIGNING_PROXY_URL; accept id for identification
    constructor(id) {
        this.id = id;
    }
    async sign(digestBuf) {
        const resp = await signingProxyClient_1.default.signAuditHash(digestBuf);
        return resp;
    }
    async verify(signatureBase64, digestBuf) {
        return signingProxyClient_1.default.verifySignature(signatureBase64, digestBuf);
    }
}
/** KMS signer wrapper for a particular KMS KeyId */
class KmsSignerClient {
    constructor(keyId, alg = 'rsa-sha256') {
        this.keyId = keyId;
        this.id = `kms:${keyId}`;
        this.client = new client_kms_1.KMSClient({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1' });
        this.alg = alg.toLowerCase();
    }
    async sign(digestBuf) {
        if (!buffer_1.Buffer.isBuffer(digestBuf))
            throw new Error('digestBuf must be Buffer');
        if (this.alg === 'hmac-sha256' || this.alg === 'hmac') {
            const cmd = new client_kms_1.GenerateMacCommand({
                KeyId: this.keyId,
                Message: digestBuf,
                MacAlgorithm: 'HMAC_SHA_256'
            });
            const resp = await this.client.send(cmd);
            if (!resp?.Mac)
                throw new Error('KMS GenerateMac returned no Mac');
            return { kid: this.keyId, alg: 'hmac-sha256', signature: buffer_1.Buffer.from(resp.Mac).toString('base64') };
        }
        if (this.alg === 'rsa-sha256' || this.alg === 'rsa') {
            // Use digest semantics
            const cmd = new client_kms_1.SignCommand({
                KeyId: this.keyId,
                Message: digestBuf,
                SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
                MessageType: 'DIGEST'
            });
            const resp = await this.client.send(cmd);
            if (!resp?.Signature)
                throw new Error('KMS Sign returned no Signature');
            return { kid: this.keyId, alg: 'rsa-sha256', signature: buffer_1.Buffer.from(resp.Signature).toString('base64') };
        }
        if (this.alg === 'ed25519' || this.alg === 'ed25519-sha') {
            const cmd = new client_kms_1.SignCommand({
                KeyId: this.keyId,
                Message: digestBuf,
                SigningAlgorithm: 'ED25519'
            });
            const resp = await this.client.send(cmd);
            if (!resp?.Signature)
                throw new Error('KMS Sign returned no Signature');
            return { kid: this.keyId, alg: 'ed25519', signature: buffer_1.Buffer.from(resp.Signature).toString('base64') };
        }
        throw new Error(`Unsupported KMS signer alg: ${this.alg}`);
    }
    async verify(signatureBase64, digestBuf) {
        if (!buffer_1.Buffer.isBuffer(digestBuf))
            throw new Error('digestBuf must be Buffer');
        const sigBuf = buffer_1.Buffer.from(signatureBase64, 'base64');
        if (this.alg === 'hmac-sha256' || this.alg === 'hmac') {
            const cmd = new client_kms_1.VerifyMacCommand({
                KeyId: this.keyId,
                Message: digestBuf,
                Mac: sigBuf,
                MacAlgorithm: 'HMAC_SHA_256'
            });
            const resp = await this.client.send(cmd);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyResp = resp;
            return Boolean(anyResp?.MacValid);
        }
        if (this.alg === 'rsa-sha256' || this.alg === 'rsa') {
            const cmd = new client_kms_1.VerifyCommand({
                KeyId: this.keyId,
                Message: digestBuf,
                Signature: sigBuf,
                SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
                MessageType: 'DIGEST'
            });
            const resp = await this.client.send(cmd);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyResp = resp;
            return Boolean(anyResp?.SignatureValid);
        }
        if (this.alg === 'ed25519' || this.alg === 'ed25519-sha') {
            const cmd = new client_kms_1.VerifyCommand({
                KeyId: this.keyId,
                Message: digestBuf,
                Signature: sigBuf,
                SigningAlgorithm: 'ED25519'
            });
            const resp = await this.client.send(cmd);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyResp = resp;
            return Boolean(anyResp?.SignatureValid);
        }
        throw new Error(`Unsupported KMS verify alg: ${this.alg}`);
    }
}
/* -------------------------
   Multisig Coordinator
   ------------------------- */
class MultiSigCoordinator {
    constructor(signers, threshold = 3) {
        if (!Array.isArray(signers) || signers.length === 0) {
            throw new Error('signers required');
        }
        this.signers = signers;
        this.threshold = Math.min(Math.max(1, threshold), signers.length);
    }
    /**
     * Sign a precomputed digest buffer using all signers (concurrently).
     * Returns collected signatures (could be > threshold). Does not abort on individual signer failures.
     */
    async collectSignatures(digestBuf) {
        const promises = this.signers.map(async (s) => {
            try {
                const res = await s.sign(digestBuf);
                return { signerId: s.id, kid: res.kid, alg: res.alg, signature: res.signature };
            }
            catch (err) {
                // log and continue
                console.error(`[multi] signer ${s.id} failed:`, err.message || String(err));
                return null;
            }
        });
        const results = await Promise.all(promises);
        return results.filter(Boolean);
    }
    /**
     * Verify a combined proof: ensure at least threshold signatures are valid.
     * Returns { ok, validCount, errors }.
     */
    async verifyCombinedProof(proof) {
        const digestBuf = buffer_1.Buffer.from(proof.digestHex, 'hex');
        let validCount = 0;
        const errors = [];
        // For each signature, find matching signer and verify
        for (const sig of proof.signatures ?? []) {
            const signer = this.signers.find((s) => s.id === sig.signerId);
            if (!signer) {
                errors.push(`unknown signerId=${sig.signerId}`);
                continue;
            }
            try {
                const ok = await signer.verify(sig.signature, digestBuf);
                if (ok)
                    validCount += 1;
                else
                    errors.push(`signature invalid for signer ${sig.signerId}`);
            }
            catch (err) {
                errors.push(`verify error for signer ${sig.signerId}: ${err.message || String(err)}`);
            }
        }
        const ok = validCount >= (proof.threshold ?? this.threshold);
        return { ok, validCount, errors };
    }
    /**
     * Convenience method: orchestrate collection and produce combined proof object.
     */
    async createCombinedProof(digestBuf) {
        const signatures = await this.collectSignatures(digestBuf);
        const digestHex = digestBuf.toString('hex');
        // Count quick validity via each signer's verify where possible (best-effort)
        let okCount = 0;
        for (const sig of signatures) {
            try {
                const signer = this.signers.find((s) => s.id === sig.signerId);
                if (!signer)
                    continue;
                if (await signer.verify(sig.signature, digestBuf))
                    okCount += 1;
            }
            catch {
                // ignore
            }
        }
        return {
            digestHex,
            threshold: this.threshold,
            requestedAt: new Date().toISOString(),
            signatures,
            okCount
        };
    }
}
exports.MultiSigCoordinator = MultiSigCoordinator;
/* -------------------------
   Utilities: create signer from spec strings
   ------------------------- */
function createSignerFromSpec(spec) {
    // spec format: "mock", "proxy", "proxy:<id>", "kms:<keyId>[:alg]" or "kms:<keyId>"
    if (!spec || typeof spec !== 'string')
        throw new Error('invalid signer spec');
    const lower = spec.toLowerCase();
    if (lower === 'mock') {
        return new MockSignerClient('mock');
    }
    if (lower.startsWith('proxy')) {
        // allow "proxy" or "proxy:<id>"
        const parts = spec.split(':', 2);
        const id = parts[1] ?? 'proxy';
        return new ProxySignerClient(id);
    }
    if (lower.startsWith('kms:')) {
        // allow "kms:<keyId>" or "kms:<keyId>:alg"
        const parts = spec.split(':');
        const keyId = parts[1];
        const alg = parts[2] ?? 'rsa-sha256';
        return new KmsSignerClient(keyId, alg);
    }
    throw new Error(`unsupported signer spec: ${spec}`);
}
/* -------------------------
   CLI entrypoint
   ------------------------- */
function parseArgCli(name) {
    const prefix = `--${name}=`;
    const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : undefined;
}
async function mainCli() {
    const specsArg = parseArgCli('specs');
    const digestArg = parseArgCli('digest');
    const thresholdArg = parseArgCli('threshold');
    if (!specsArg) {
        console.error('Missing --specs (comma-separated signer specs, e.g. mock,kms:arn:...,proxy)');
        process.exit(2);
    }
    if (!digestArg) {
        console.error('Missing --digest (hex SHA-256 digest)');
        process.exit(2);
    }
    const specs = specsArg.split(',').map((s) => s.trim()).filter(Boolean);
    const signers = specs.map(createSignerFromSpec);
    const threshold = thresholdArg ? Number(thresholdArg) : Math.min(3, signers.length);
    const digestHex = digestArg.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(digestHex)) {
        console.error('digest must be 32-byte SHA-256 hex string (64 hex chars)');
        process.exit(3);
    }
    const digestBuf = buffer_1.Buffer.from(digestHex, 'hex');
    const coord = new MultiSigCoordinator(signers, threshold);
    console.log(`Collecting signatures from ${signers.length} signers with threshold=${coord.threshold}...`);
    const proof = await coord.createCombinedProof(digestBuf);
    console.log(JSON.stringify(proof, null, 2));
    // Exit code 0 regardless; caller can inspect proof.okCount
}
if (require.main === module) {
    mainCli().catch((err) => {
        console.error('multisig failed:', err.message || String(err));
        process.exit(10);
    });
}
exports.default = {
    MultiSigCoordinator,
    createSignerFromSpec
};
