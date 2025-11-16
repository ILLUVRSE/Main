/**
 * memory-layer/service/vector/vectorDbAdapter.ts
 *
 * Vector DB adapter with provider abstraction and queue fallback.
 *
 * Behavior:
 *  - Supports `provider = 'postgres'` by writing vector payloads into `memory_vectors` table
 *    (this is the simple/default provider used for dev and small-scale infra).
 *  - For other providers (pinecone, milvus, etc.) the adapter will attempt an HTTP-based write
 *    if `endpoint` is configured. If that fails or provider not supported, and if
 *    process.env.VECTOR_WRITE_QUEUE === 'true' then the adapter will enqueue a `memory_vectors`
 *    row with status='pending' so `vectorWorker` can retry.
 *
 *  - Search is implemented as a brute-force cosine similarity over `memory_vectors.vector_data`
 *    for namespace where status = 'completed'. This is functional and deterministic for dev;
 *    production should register a provider that offers ANN search.
 *
 * NOTE: This adapter intentionally keeps provider implementations small and pluggable.
 */

import type { Pool } from 'pg';
import { getPool } from '../db';
import https from 'https';
import http from 'http';

export interface VectorDbConfig {
  provider?: string;
  endpoint?: string;
  apiKey?: string;
  namespace?: string;
  pool?: Pool;
}

export interface VectorWriteResult {
  status: 'queued' | 'completed';
  externalVectorId?: string | null;
}

export interface VectorSearchResult {
  memoryNodeId: string;
  score: number;
  metadata?: Record<string, unknown>;
  vectorRef?: string | null;
}

const cosineSimilarity = (a: number[], b: number[]): number => {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const ensureVector = (embedding: { vector?: number[]; dimension?: number }): number[] => {
  if (!embedding?.vector?.length) {
    throw new Error('Embedding vector is required for upsert.');
  }
  if (typeof embedding.dimension === 'number' && embedding.dimension !== embedding.vector.length) {
    throw new Error(`Embedding dimension mismatch (expected ${embedding.dimension}, got ${embedding.vector.length}).`);
  }
  return embedding.vector.map((value, idx) => {
    if (!Number.isFinite(value)) {
      throw new Error(`Embedding vector index ${idx} is not a finite number.`);
    }
    return value;
  });
};

export class VectorDbAdapter {
  private readonly provider: string;
  private readonly namespace: string;
  private readonly pool?: Pool;
  private readonly endpoint?: string;
  private readonly apiKey?: string;

  constructor(private readonly config: VectorDbConfig) {
    this.provider = (config?.provider ?? 'postgres').toLowerCase();
    this.namespace = config.namespace ?? 'kernel-memory';
    this.pool = config.pool ?? getPool();
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
  }

  /**
   * Upsert embedding for a memory node.
   * - For `postgres` provider: writes `memory_vectors` row with status='completed' and vector_data JSONB.
   * - For other providers: attempts a best-effort HTTP write to `endpoint` (if configured). On failure,
   *   will enqueue a pending `memory_vectors` row if VECTOR_WRITE_QUEUE === 'true', otherwise throws.
   */
  async upsertEmbedding(params: {
    memoryNodeId: string;
    embeddingId?: string | null;
    embedding: { model: string; dimension?: number; vector: number[]; namespace?: string };
    metadata?: Record<string, unknown>;
  }): Promise<VectorWriteResult> {
    const namespace = params.embedding.namespace ?? this.namespace;
    const vector = ensureVector(params.embedding);
    const provider = this.provider;
    const metadata = {
      ...(params.metadata ?? {}),
      owner: (params.metadata as { owner?: string })?.owner ?? undefined
    };
    const externalRef = params.embeddingId ?? params.memoryNodeId;

    if (provider === 'postgres') {
      // Store the vector in memory_vectors table for local postgres-based vector store/search.
      const { rows } = await (this.pool as Pool).query<{ id: string }>(
        `
        INSERT INTO memory_vectors (
          memory_node_id,
          provider,
          namespace,
          embedding_model,
          dimension,
          external_vector_id,
          status,
          error,
          vector_data,
          metadata,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'completed', NULL, $7::jsonb, COALESCE($8::jsonb,'{}'::jsonb), now(), now())
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
      `,
        [
          params.memoryNodeId,
          provider,
          namespace,
          params.embedding.model,
          params.embedding.dimension ?? vector.length,
          externalRef,
          JSON.stringify(vector),
          JSON.stringify(metadata ?? {})
        ]
      );

      return {
        status: 'completed',
        externalVectorId: rows[0]?.id ?? externalRef
      };
    }

    // Non-postgres provider path: try to call external provider if endpoint is configured.
    if (this.endpoint) {
      try {
        await this.callExternalProviderWrite(provider, this.endpoint, this.apiKey ?? undefined, {
          id: externalRef,
          vector,
          metadata,
          model: params.embedding.model,
          namespace
        });
        // On success, return completed. (We don't have an external id; use externalRef)
        return { status: 'completed', externalVectorId: externalRef };
      } catch (err) {
        // on failure, either queue or throw
        const msg = (err as Error).message || String(err);
        // if queue fallback enabled, insert pending row into memory_vectors and return queued.
        const queueEnabled = String(process.env.VECTOR_WRITE_QUEUE ?? 'true').toLowerCase() === 'true';
        if (queueEnabled) {
          try {
            await (this.pool as Pool).query(
              `
              INSERT INTO memory_vectors (
                memory_node_id,
                provider,
                namespace,
                embedding_model,
                dimension,
                external_vector_id,
                status,
                error,
                vector_data,
                metadata,
                created_at,
                updated_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,now(),now())
              ON CONFLICT (memory_node_id, namespace) DO UPDATE
                SET vector_data = EXCLUDED.vector_data,
                    embedding_model = EXCLUDED.embedding_model,
                    dimension = EXCLUDED.dimension,
                    external_vector_id = EXCLUDED.external_vector_id,
                    status = 'pending',
                    error = EXCLUDED.error,
                    updated_at = now()
            `,
              [
                params.memoryNodeId,
                provider,
                namespace,
                params.embedding.model,
                params.embedding.dimension ?? vector.length,
                externalRef,
                'pending',
                `external_write_error: ${msg}`,
                JSON.stringify(vector),
                JSON.stringify(metadata ?? {})
              ]
            );
            return { status: 'queued', externalVectorId: null };
          } catch (uerr) {
            // If queue enqueue fails, throw original error
            throw new Error(`external provider write failed: ${msg}; additionally failed enqueue: ${(uerr as Error).message || uerr}`);
          }
        }
        throw new Error(`external provider write failed: ${msg}`);
      }
    }

    // No endpoint configured: fallback to queue if enabled, otherwise error.
    const queueEnabled = String(process.env.VECTOR_WRITE_QUEUE ?? 'true').toLowerCase() === 'true';
    if (queueEnabled) {
      await (this.pool as Pool).query(
        `
        INSERT INTO memory_vectors (
          memory_node_id,
          provider,
          namespace,
          embedding_model,
          dimension,
          external_vector_id,
          status,
          error,
          vector_data,
          metadata,
          created_at,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,now(),now())
        ON CONFLICT (memory_node_id, namespace) DO UPDATE
          SET vector_data = EXCLUDED.vector_data,
              embedding_model = EXCLUDED.embedding_model,
              dimension = EXCLUDED.dimension,
              external_vector_id = EXCLUDED.external_vector_id,
              status = 'pending',
              error = EXCLUDED.error,
              updated_at = now()
      `,
        [
          params.memoryNodeId,
          provider,
          namespace,
          params.embedding.model,
          params.embedding.dimension ?? vector.length,
          externalRef,
          'pending',
          'no_provider_endpoint',
          JSON.stringify(vector),
          JSON.stringify(metadata ?? {})
        ]
      );
      return { status: 'queued', externalVectorId: null };
    }

    throw new Error(`vector provider ${provider} not supported and no queue fallback configured`);
  }

  /**
   * Brute-force search over memory_vectors.vector_data (JSONB array).
   * Returns topK results with cosine similarity.
   */
  async search(request: {
    queryEmbedding?: number[];
    topK?: number;
    namespace?: string;
    scoreThreshold?: number;
  }): Promise<VectorSearchResult[]> {
    if (!request.queryEmbedding?.length) {
      throw new Error('queryEmbedding is required.');
    }
    const namespace = request.namespace ?? this.namespace;
    const queryVector = ensureVector({ vector: request.queryEmbedding, dimension: request.queryEmbedding.length });
    const topK = Math.max(1, Math.min(request.topK ?? 10, 100));

    // Query Postgres memory_vectors where namespace matches and status completed.
    const { rows } = await (this.pool as Pool).query<{
      id: string;
      memory_node_id: string;
      vector_data: number[];
      metadata: Record<string, unknown>;
    }>(
      `
      SELECT id, memory_node_id, vector_data, metadata
      FROM memory_vectors
      WHERE namespace = $1
        AND status = 'completed'
        AND vector_data IS NOT NULL
    `,
      [namespace]
    );

    const scored = rows
      .map((row) => {
        const targetVector = Array.isArray(row.vector_data) ? row.vector_data : [];
        const score = cosineSimilarity(queryVector, targetVector);
        return {
          memoryNodeId: row.memory_node_id,
          score,
          metadata: row.metadata ?? {},
          vectorRef: row.id
        };
      })
      .filter((entry) => Number.isFinite(entry.score))
      .filter((entry) => (typeof request.scoreThreshold === 'number' ? entry.score >= request.scoreThreshold : true))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  /**
   * Health check: for postgres provider ensure pool query works; for others ensure pool ok and endpoint optionally reachable.
   */
  async healthCheck(): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    try {
      if (this.provider === 'postgres') {
        await (this.pool as Pool).query('SELECT 1');
        return {
          healthy: true,
          details: { provider: 'postgres', namespace: this.namespace }
        };
      }

      // For non-postgres, try DB connectivity (for queue writes) and optionally ping endpoint
      await (this.pool as Pool).query('SELECT 1');

      if (this.endpoint) {
        // perform basic HTTP GET to endpoint root
        const url = new URL(this.endpoint);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        // promise wrapper for simple GET
        await new Promise<void>((resolve, reject) => {
          const req = lib.request(
            {
              method: 'GET',
              hostname: url.hostname,
              port: url.port ? Number(url.port) : undefined,
              path: url.pathname || '/',
              timeout: 5000,
              headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}
            },
            (res) => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
                // treat 2xx-4xx as reachable (4xx could be auth denied)
                resolve();
              } else {
                reject(new Error(`endpoint returned ${res.statusCode}`));
              }
            }
          );
          req.on('error', (err) => reject(err));
          req.on('timeout', () => {
            req.destroy(new Error('timeout'));
          });
          req.end();
        });
        return { healthy: true, details: { provider: this.provider, endpoint: this.endpoint } };
      }

      return { healthy: true, details: { provider: this.provider, note: 'no endpoint configured, using DB queue' } };
    } catch (error) {
      return { healthy: false, details: { error: (error as Error).message } };
    }
  }

  /**
   * Generic external provider write helper (best-effort).
   * Implementations for real providers should replace this with SDK clients.
   */
  private callExternalProviderWrite(
    provider: string,
    endpoint: string,
    apiKey: string | undefined,
    payload: { id: string; vector: number[]; metadata?: Record<string, unknown>; model?: string; namespace?: string }
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        const url = new URL(endpoint);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        const path = url.pathname.endsWith('/') ? `${url.pathname}vectors` : `${url.pathname}/vectors`;
        const fullPath = path + (url.search ?? '');
        const body = JSON.stringify(payload);

        const opts: (https.RequestOptions | http.RequestOptions) = {
          method: 'POST',
          hostname: url.hostname,
          port: url.port ? Number(url.port) : undefined,
          path: fullPath,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
          },
          timeout: 10_000
        };

        const req = lib.request(opts, (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve();
          } else {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              reject(new Error(`provider ${provider} responded ${status}: ${data}`));
            });
          }
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
          req.destroy(new Error('request timed out'));
        });
        req.write(body);
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

