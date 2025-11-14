"use strict";
/**
 * kernel/src/signingProvider.ts
 *
 * Production-minded signing provider utilities for Kernel.
 *
 * Changes:
 * - LocalSigningProvider.signManifest and FakeKmsSigningProvider.signManifest
 *   now return a plain UUID for the `id` field (crypto.randomUUID()) so that
 *   manifest_signatures.id (UUID column) is always satisfied in dev/fallback flows.
 *
 * Note: Do NOT change the observable `manifestId`/`signerId`/`signature` shapes
 * — only the wrapper `id` generation is updated to be UUID-only.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpKmsSigningProvider = exports.FakeKmsSigningProvider = exports.LocalSigningProvider = void 0;
exports.canonicalizePayload = canonicalizePayload;
exports.prepareManifestSigningRequest = prepareManifestSigningRequest;
exports.prepareDataSigningRequest = prepareDataSigningRequest;
exports.createSigningProvider = createSigningProvider;
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const https_1 = __importDefault(require("https"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const kms_1 = require("./config/kms");
function canonicalizePayload(obj) {
    const normalize = (value) => {
        if (value === null || typeof value !== 'object')
            return value;
        if (Array.isArray(value))
            return value.map(normalize);
        const out = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = normalize(value[key]);
        }
        return out;
    };
    return JSON.stringify(normalize(obj));
}
function prepareManifestSigningRequest(manifest) {
    const ts = new Date().toISOString();
    const manifestId = manifest?.id ?? `manifest-${crypto_1.default.randomUUID()}`;
    const version = manifest?.version ?? '1.0.0';
    const payload = canonicalizePayload({ manifest, ts });
    return { manifest, manifestId, ts, payload, version };
}
function prepareDataSigningRequest(data) {
    const ts = new Date().toISOString();
    const payload = canonicalizePayload({ data, ts });
    return { data, payload, ts };
}
const localKeyCache = new Map();
function getOrCreateKeyPair(signerId) {
    if (!localKeyCache.has(signerId)) {
        localKeyCache.set(signerId, crypto_1.default.generateKeyPairSync('ed25519'));
    }
    return localKeyCache.get(signerId);
}
class LocalSigningProvider {
    signerId;
    constructor(signerId = 'kernel-signer-local') {
        this.signerId = signerId;
    }
    async signManifest(manifest, request) {
        const prepared = request ?? prepareManifestSigningRequest(manifest);
        const { privateKey } = getOrCreateKeyPair(this.signerId);
        const signature = crypto_1.default.sign(null, Buffer.from(prepared.payload), privateKey).toString('base64');
        return {
            // Use a plain UUID here to match manifest_signatures.id UUID column expectations.
            id: crypto_1.default.randomUUID(),
            manifestId: prepared.manifestId,
            signerId: this.signerId,
            signature,
            version: prepared.version,
            ts: prepared.ts,
            prevHash: null,
        };
    }
    async signData(data, request) {
        const prepared = request ?? prepareDataSigningRequest(data);
        const { privateKey } = getOrCreateKeyPair(this.signerId);
        const signature = crypto_1.default.sign(null, Buffer.from(prepared.payload), privateKey).toString('base64');
        return { signature, signerId: this.signerId };
    }
    async getPublicKey(_signerId) {
        const { publicKey } = getOrCreateKeyPair(this.signerId);
        const exported = publicKey.export({ format: 'der', type: 'spki' });
        return exported.toString('base64');
    }
}
exports.LocalSigningProvider = LocalSigningProvider;
function mapKmsManifestResponse(body, manifestId, fallbackSignerId, ts) {
    const mappedId = body.id ?? body.signature_id ?? crypto_1.default.randomUUID();
    const signerId = body.signer_id ?? body.signerId ?? fallbackSignerId;
    const responseManifestId = body.manifest_id ?? body.manifestId ?? manifestId;
    return {
        id: String(mappedId),
        manifestId: responseManifestId,
        signerId,
        signature: body.signature ?? body.sig ?? '',
        version: body.version ?? body.key_version ?? undefined,
        ts: body.ts ?? ts,
        prevHash: body.prev_hash ?? body.prevHash ?? null,
    };
}
class HttpKmsSigningProvider {
    config;
    agent;
    constructor(config) {
        this.config = config;
        this.agent = this.createHttpsAgentIfNeeded();
    }
    createHttpsAgentIfNeeded() {
        if (this.config.mtlsCertPath && this.config.mtlsKeyPath) {
            try {
                const cert = fs_1.default.readFileSync(this.config.mtlsCertPath);
                const key = fs_1.default.readFileSync(this.config.mtlsKeyPath);
                return new https_1.default.Agent({ cert, key, keepAlive: true });
            }
            catch (err) {
                console.warn('HttpKmsSigningProvider: unable to read mTLS credentials', err);
            }
        }
        return undefined;
    }
    buildHeaders(includeContentType = true) {
        const headers = {};
        if (includeContentType)
            headers['Content-Type'] = 'application/json';
        if (this.config.bearerToken)
            headers['Authorization'] = `Bearer ${this.config.bearerToken}`;
        return headers;
    }
    async request(path, init) {
        if (!this.config.endpoint)
            throw new Error('KMS endpoint not configured');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const response = await (0, node_fetch_1.default)(`${this.config.endpoint}${path}`, {
                ...init,
                agent: this.agent,
                signal: controller.signal,
            });
            if (!response.ok) {
                const txt = await response.text().catch(() => '<no body>');
                throw new Error(`KMS error ${response.status}: ${txt}`);
            }
            if (response.headers.get('content-type')?.includes('application/json')) {
                return await response.json();
            }
            return await response.text();
        }
        finally {
            clearTimeout(timer);
        }
    }
    async signManifest(manifest, request) {
        const prepared = request ?? prepareManifestSigningRequest(manifest);
        const body = {
            signerId: this.config.signerId,
            payload: prepared.payload,
            manifestId: prepared.manifestId,
        };
        const response = await this.request('/sign', {
            method: 'POST',
            headers: this.buildHeaders(true),
            body: JSON.stringify(body),
        });
        return mapKmsManifestResponse(response, prepared.manifestId, this.config.signerId, prepared.ts);
    }
    async signData(data, request) {
        const prepared = request ?? prepareDataSigningRequest(data);
        const body = {
            signerId: this.config.signerId,
            data: prepared.payload,
        };
        const response = await this.request('/signData', {
            method: 'POST',
            headers: this.buildHeaders(true),
            body: JSON.stringify(body),
        });
        return {
            signature: response.signature,
            signerId: response.signerId ?? response.signer_id ?? this.config.signerId,
        };
    }
    async getPublicKey(signerId = this.config.signerId) {
        try {
            const result = await this.request(`/publicKeys/${encodeURIComponent(signerId)}`, {
                method: 'GET',
                headers: this.buildHeaders(false),
            });
            if (typeof result === 'string')
                return result;
            return result?.publicKey ?? result?.public_key ?? null;
        }
        catch (err) {
            throw new Error(`KMS getPublicKey failed: ${err.message || err}`);
        }
    }
}
exports.HttpKmsSigningProvider = HttpKmsSigningProvider;
class FakeKmsSigningProvider {
    options;
    constructor(options = {}) {
        this.options = options;
    }
    async signManifest(manifest, request) {
        const prepared = request ?? prepareManifestSigningRequest(manifest);
        return {
            // Return plain UUID here as well to avoid invalid-UUID inserts into manifest_signatures.
            id: crypto_1.default.randomUUID(),
            manifestId: this.options.manifestId ?? prepared.manifestId,
            signerId: this.options.signerId ?? 'fake-kms-signer',
            signature: this.options.signature ?? Buffer.from('fake-signature').toString('base64'),
            version: this.options.version ?? prepared.version,
            ts: this.options.ts ?? prepared.ts,
            prevHash: null,
        };
    }
    async signData(data, request) {
        const prepared = request ?? prepareDataSigningRequest(data);
        return {
            signature: this.options.signature ?? Buffer.from(`fake:${prepared.payload}`).toString('base64'),
            signerId: this.options.signerId ?? 'fake-kms-signer',
        };
    }
    async getPublicKey(_signerId) {
        return this.options.publicKey ?? Buffer.from('fake-public-key').toString('base64');
    }
}
exports.FakeKmsSigningProvider = FakeKmsSigningProvider;
function createSigningProvider(config = (0, kms_1.loadKmsConfig)(), type = 'auto') {
    if (type === 'local' || (type === 'auto' && !config.endpoint)) {
        return new LocalSigningProvider(config.signerId);
    }
    return new HttpKmsSigningProvider(config);
}
