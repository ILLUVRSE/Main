"use strict";
/**
 * kernel/src/embedding/vecdb.ts
 *
 * Minimal abstraction for storing and querying embeddings associated with
 * MemoryNodes. The default implementation is an in-memory vector store used
 * by tests and local development. Production deployments can supply a
 * `VECTOR_DB_ENDPOINT` to enable a remote connector.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpVectorStore = exports.InMemoryVectorStore = void 0;
exports.createVectorStore = createVectorStore;
exports.getVectorStore = getVectorStore;
exports.setVectorStore = setVectorStore;
const node_fetch_1 = __importDefault(require("node-fetch"));
function cosineSimilarity(a, b) {
    if (!a.length || a.length !== b.length) {
        return 0;
    }
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i += 1) {
        const va = a[i];
        const vb = b[i];
        dot += va * vb;
        magA += va * va;
        magB += vb * vb;
    }
    if (!magA || !magB) {
        return 0;
    }
    return dot / Math.sqrt(magA * magB);
}
/**
 * InMemoryVectorStore is a lightweight Map-backed store primarily used for
 * unit tests. It stores vectors verbatim and performs brute-force cosine
 * similarity for queries.
 */
class InMemoryVectorStore {
    store = new Map();
    async upsertEmbedding(id, vector, metadata) {
        if (!Array.isArray(vector) || !vector.length) {
            throw new Error('vector must be a non-empty array');
        }
        this.store.set(id, { vector: vector.map((v) => Number(v)), metadata: metadata || null });
    }
    async query(vector, topK) {
        if (!Array.isArray(vector) || !vector.length) {
            return [];
        }
        const limit = Math.max(1, Math.min(topK || 1, this.store.size || 1));
        const entries = Array.from(this.store.entries()).map(([id, record]) => ({
            id,
            score: cosineSimilarity(vector, record.vector),
            metadata: record.metadata ?? null,
        }));
        return entries
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .filter((match) => Number.isFinite(match.score));
    }
}
exports.InMemoryVectorStore = InMemoryVectorStore;
/**
 * HttpVectorStore forwards operations to an HTTP endpoint that exposes a
 * minimal REST API (`PUT /embeddings/:id` and `POST /query`).
 */
class HttpVectorStore {
    baseUrl;
    apiKey;
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    headers() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers.Authorization = `Bearer ${this.apiKey}`;
        }
        return headers;
    }
    async upsertEmbedding(id, vector, metadata) {
        const url = `${this.baseUrl}/embeddings/${encodeURIComponent(id)}`;
        const res = await (0, node_fetch_1.default)(url, {
            method: 'PUT',
            headers: this.headers(),
            body: JSON.stringify({ id, vector, metadata: metadata ?? null }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Vector DB upsert failed (${res.status}): ${text || res.statusText}`);
        }
    }
    async query(vector, topK) {
        const url = `${this.baseUrl}/query`;
        const res = await (0, node_fetch_1.default)(url, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ vector, topK }),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Vector DB query failed (${res.status}): ${text || res.statusText}`);
        }
        const payload = (await res.json());
        return Array.isArray(payload.matches) ? payload.matches : [];
    }
}
exports.HttpVectorStore = HttpVectorStore;
let sharedStore = null;
function createVectorStore(config) {
    const provider = (config?.provider || process.env.VECDB_PROVIDER || 'memory').toLowerCase();
    if (provider === 'http') {
        const endpoint = config?.endpoint || process.env.VECTOR_DB_ENDPOINT;
        if (!endpoint) {
            throw new Error('VECTOR_DB_ENDPOINT must be set when VECDB_PROVIDER=http');
        }
        return new HttpVectorStore(endpoint, config?.apiKey || process.env.VECTOR_DB_API_KEY);
    }
    return new InMemoryVectorStore();
}
function getVectorStore() {
    if (!sharedStore) {
        sharedStore = createVectorStore();
    }
    return sharedStore;
}
function setVectorStore(store) {
    sharedStore = store;
}
