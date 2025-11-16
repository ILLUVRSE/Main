"use strict";
/**
 * memory-layer/service/vector/vectorDbAdapter.ts
 *
 * Vector DB adapter with provider abstraction and DB-queue fallback.
 *
 * - Default provider: 'postgres' (writes vector_data JSONB to memory_vectors table,
 *   which is suitable for small-scale dev + pgvector if the extension is installed).
 * - External providers: attempt HTTP write to configured endpoint; on failure enqueue
 *   a pending memory_vectors row so `vectorWorker` can retry.
 * - Search: for postgres provider we compute brute-force cosine similarity over stored
 *   vector_data. Production should replace this with a proper ANN provider.
 *
 * Notes:
 * - This implementation focuses on correctness and observability for acceptance.
 * - For production integrate real provider SDKs (pgvector, milvus, pinecone) and ensure
 *   SLOs for latency and idempotent upserts.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VectorDbAdapter = void 0;
const db_1 = require("../db");
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const DEFAULT_NAMESPACE = 'kernel-memory';
const DEFAULT_PROVIDER = 'postgres';
function cosineSimilarity(a, b) {
    if (!a?.length || !b?.length || a.length !== b.length)
        return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
        const ai = Number(a[i]) || 0;
        const bi = Number(b[i]) || 0;
        dot += ai * bi;
        na += ai * ai;
        nb += bi * bi;
    }
    if (!na || !nb)
        return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function ensureVector(embedding) {
    if (!embedding?.vector || !Array.isArray(embedding.vector) || !embedding.vector.length) {
        throw new Error('embedding.vector is required and must be a non-empty array');
    }
    if (typeof embedding.dimension === 'number' && embedding.dimension !== embedding.vector.length) {
        throw new Error(`embedding.dimension mismatch: declared=${embedding.dimension} actual=${embedding.vector.length}`);
    }
    // coerce to numbers
    return embedding.vector.map((v, i) => {
        const n = Number(v);
        if (!isFinite(n))
            throw new Error(`embedding.vector[${i}] is not a finite number`);
        return n;
    });
}
/**
 * VectorDbAdapter
 */
class VectorDbAdapter {
    constructor(cfg = {}) {
        this.provider = (cfg.provider ?? DEFAULT_PROVIDER).toLowerCase();
        this.namespace = cfg.namespace ?? DEFAULT_NAMESPACE;
        this.pool = cfg.pool ?? (0, db_1.getPool)();
        this.endpoint = cfg.endpoint;
        this.apiKey = cfg.apiKey;
    }
    /**
     * Upsert embedding for a memory node.
     * Behavior:
     *  - postgres: write memory_vectors row with status='completed'
     *  - external provider with endpoint: attempt HTTP POST; on failure, enqueue pending memory_vectors row
     *  - if queue fallback enabled (VECTOR_WRITE_QUEUE=true) will write pending row for retry
     */
    async upsertEmbedding(params) {
        const namespace = params.embedding.namespace ?? this.namespace;
        const vector = ensureVector(params.embedding);
        const provider = this.provider;
        const metadata = params.metadata ?? {};
        const externalRef = params.embeddingId ?? params.memoryNodeId;
        if (provider === 'postgres') {
            // Insert or update memory_vectors with completed state
            const { rows } = await this.pool.query(`
        INSERT INTO memory_vectors (
          memory_node_id, provider, namespace, embedding_model, dimension,
          external_vector_id, status, error, vector_data, metadata, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,'completed',NULL,$7::jsonb,$8::jsonb, now(), now())
        ON CONFLICT (memory_node_id, namespace) DO UPDATE
          SET embedding_model = EXCLUDED.embedding_model,
              dimension = EXCLUDED.dimension,
              external_vector_id = EXCLUDED.external_vector_id,
              status = 'completed',
              error = NULL,
              vector_data = EXCLUDED.vector_data,
              metadata = EXCLUDED.metadata,
              updated_at = now()
        RETURNING id
      `, [
                params.memoryNodeId,
                provider,
                namespace,
                params.embedding.model,
                params.embedding.dimension ?? vector.length,
                externalRef,
                JSON.stringify(vector),
                JSON.stringify(metadata)
            ]);
            return { status: 'completed', externalVectorId: rows[0]?.id ?? externalRef };
        }
        // Non-postgres provider path
        if (this.endpoint) {
            try {
                await this.callExternalProviderWrite({
                    id: externalRef,
                    vector,
                    metadata,
                    model: params.embedding.model,
                    namespace
                });
                // on success, return completed and externalRef
                return { status: 'completed', externalVectorId: externalRef };
            }
            catch (err) {
                const msg = err.message || String(err);
                const queueEnabled = String(process.env.VECTOR_WRITE_QUEUE ?? 'true').toLowerCase() === 'true';
                if (queueEnabled) {
                    // enqueue pending row in Postgres
                    await this.pool.query(`
            INSERT INTO memory_vectors (
              memory_node_id, provider, namespace, embedding_model, dimension,
              external_vector_id, status, error, vector_data, metadata, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb, now(), now())
            ON CONFLICT (memory_node_id, namespace) DO UPDATE
              SET vector_data = EXCLUDED.vector_data,
                  embedding_model = EXCLUDED.embedding_model,
                  dimension = EXCLUDED.dimension,
                  external_vector_id = EXCLUDED.external_vector_id,
                  status = 'pending',
                  error = EXCLUDED.error,
                  updated_at = now()
          `, [
                        params.memoryNodeId,
                        provider,
                        namespace,
                        params.embedding.model,
                        params.embedding.dimension ?? vector.length,
                        externalRef,
                        'pending',
                        `external_write_error: ${msg}`,
                        JSON.stringify(vector),
                        JSON.stringify(metadata)
                    ]);
                    return { status: 'queued', externalVectorId: null };
                }
                // otherwise propagate error
                throw new Error(`external provider write failed: ${msg}`);
            }
        }
        // No endpoint & not postgres: fallback to queue or error
        const queueEnabled = String(process.env.VECTOR_WRITE_QUEUE ?? 'true').toLowerCase() === 'true';
        if (queueEnabled) {
            await this.pool.query(`
        INSERT INTO memory_vectors (
          memory_node_id, provider, namespace, embedding_model, dimension,
          external_vector_id, status, error, vector_data, metadata, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb, now(), now())
        ON CONFLICT (memory_node_id, namespace) DO UPDATE
          SET vector_data = EXCLUDED.vector_data,
              embedding_model = EXCLUDED.embedding_model,
              dimension = EXCLUDED.dimension,
              external_vector_id = EXCLUDED.external_vector_id,
              status = 'pending',
              error = EXCLUDED.error,
              updated_at = now()
      `, [
                params.memoryNodeId,
                provider,
                namespace,
                params.embedding.model,
                params.embedding.dimension ?? vector.length,
                externalRef,
                'pending',
                'no_provider_endpoint',
                JSON.stringify(vector),
                JSON.stringify(metadata)
            ]);
            return { status: 'queued', externalVectorId: null };
        }
        throw new Error(`vector provider ${provider} not supported and no queue fallback configured`);
    }
    /**
     * Brute-force search for postgres provider using stored vector_data JSONB.
     * Production: replace with ANN provider.
     */
    async search(request) {
        if (!request.queryEmbedding || !Array.isArray(request.queryEmbedding) || !request.queryEmbedding.length) {
            throw new Error('queryEmbedding is required');
        }
        const namespace = request.namespace ?? this.namespace;
        const queryVector = ensureVector({ vector: request.queryEmbedding, dimension: request.queryEmbedding.length });
        const topK = Math.max(1, Math.min(request.topK ?? 10, 200));
        // For postgres: select completed rows with vector_data not null
        const { rows } = await this.pool.query(`
      SELECT id, memory_node_id, vector_data, metadata
      FROM memory_vectors
      WHERE namespace = $1
        AND status = 'completed'
        AND vector_data IS NOT NULL
    `, [namespace]);
        const scored = rows
            .map((r) => {
            const target = Array.isArray(r.vector_data) ? r.vector_data : [];
            const score = cosineSimilarity(queryVector, target);
            return {
                memoryNodeId: r.memory_node_id,
                score,
                metadata: r.metadata ?? {},
                vectorRef: r.id
            };
        })
            .filter((e) => Number.isFinite(e.score))
            .filter((e) => (typeof request.scoreThreshold === 'number' ? e.score >= request.scoreThreshold : true))
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
        return scored;
    }
    /**
     * Health check: for postgres provider ensure DB connectivity; for others check endpoint reachable.
     */
    async healthCheck() {
        try {
            // basic DB connectivity
            await this.pool.query('SELECT 1');
            if (this.provider === 'postgres') {
                return { healthy: true, details: { provider: 'postgres', namespace: this.namespace } };
            }
            // For external provider, attempt to ping endpoint if configured
            if (this.endpoint) {
                try {
                    await this.pingEndpoint(this.endpoint, this.apiKey);
                    return { healthy: true, details: { provider: this.provider, endpoint: this.endpoint } };
                }
                catch (err) {
                    return { healthy: false, details: { provider: this.provider, error: err.message } };
                }
            }
            return { healthy: true, details: { provider: this.provider, note: 'no external endpoint configured, queue mode' } };
        }
        catch (err) {
            return { healthy: false, details: { error: err.message } };
        }
    }
    /**
     * Best-effort ping to external endpoint using simple HTTP POST /health or GET.
     */
    async pingEndpoint(endpoint, apiKey) {
        const url = new URL(endpoint);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https_1.default : http_1.default;
        return new Promise((resolve, reject) => {
            const opts = {
                method: 'GET',
                hostname: url.hostname,
                port: url.port ? Number(url.port) : undefined,
                path: url.pathname || '/',
                timeout: 5000,
                headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
            };
            const req = lib.request(opts, (res) => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
                    resolve();
                }
                else {
                    reject(new Error(`endpoint returned ${res.statusCode}`));
                }
            });
            req.on('error', (err) => reject(err));
            req.on('timeout', () => {
                req.destroy(new Error('timeout'));
            });
            req.end();
        });
    }
    /**
     * Generic best-effort external provider write helper (HTTP POST /vectors).
     */
    callExternalProviderWrite(payload) {
        if (!this.endpoint)
            throw new Error('external endpoint not configured');
        const url = new URL(this.endpoint);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https_1.default : http_1.default;
        const path = url.pathname.endsWith('/') ? `${url.pathname}vectors` : `${url.pathname}/vectors`;
        const fullPath = path + (url.search ?? '');
        const body = JSON.stringify(payload);
        const opts = {
            method: 'POST',
            hostname: url.hostname,
            port: url.port ? Number(url.port) : undefined,
            path: fullPath,
            timeout: 10000,
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
                ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
            }
        };
        return new Promise((resolve, reject) => {
            const req = lib.request(opts, (res) => {
                const status = res.statusCode ?? 0;
                if (status >= 200 && status < 300) {
                    resolve();
                }
                else {
                    let data = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk) => (data += chunk));
                    res.on('end', () => reject(new Error(`provider responded ${status}: ${data}`)));
                }
            });
            req.on('error', (err) => reject(err));
            req.on('timeout', () => {
                req.destroy(new Error('request timed out'));
            });
            req.write(body);
            req.end();
        });
    }
}
exports.VectorDbAdapter = VectorDbAdapter;
