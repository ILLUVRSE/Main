import type { Pool } from 'pg';
import type { EmbeddingPayload, SearchRequest } from '../types';

export interface VectorDbConfig {
  provider?: string;
  endpoint?: string;
  apiKey?: string;
  namespace?: string;
  pool: Pool;
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

const ensureVector = (embedding: EmbeddingPayload): number[] => {
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

export class VectorDbAdapter {
  private readonly namespace: string;

  constructor(private readonly config: VectorDbConfig) {
    if (!config?.pool) {
      throw new Error('VectorDbAdapter requires a Postgres pool instance.');
    }
    this.namespace = config.namespace ?? 'kernel-memory';
  }

  async upsertEmbedding(params: {
    memoryNodeId: string;
    embeddingId?: string | null;
    embedding: EmbeddingPayload;
    metadata?: Record<string, unknown>;
  }): Promise<VectorWriteResult> {
    const namespace = params.embedding.namespace ?? this.namespace;
    const vector = ensureVector(params.embedding);
    const provider = this.config.provider ?? 'postgres';
    const metadata = {
      ...(params.metadata ?? {}),
      owner: (params.metadata as { owner?: string })?.owner ?? undefined
    };
    const externalRef = params.embeddingId ?? params.memoryNodeId;

    const { rows } = await this.config.pool.query<{ id: string }>(
      `
        INSERT INTO memory_vectors (
          memory_node_id,
          provider,
          namespace,
          embedding_model,
          dimension,
          external_vector_id,
          status,
          vector_data,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7::jsonb, COALESCE($8::jsonb, '{}'::jsonb))
        ON CONFLICT (memory_node_id, namespace) DO UPDATE
        SET embedding_model = EXCLUDED.embedding_model,
            dimension = EXCLUDED.dimension,
            external_vector_id = EXCLUDED.external_vector_id,
            status = 'completed',
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
        JSON.stringify(metadata)
      ]
    );

    return {
      status: 'completed',
      externalVectorId: rows[0]?.id ?? externalRef
    };
  }

  async search(request: SearchRequest): Promise<VectorSearchResult[]> {
    if (!request.queryEmbedding?.length) {
      throw new Error('queryEmbedding is required.');
    }
    const namespace = request.namespace ?? this.namespace;
    const queryVector = ensureVector({ model: 'query', dimension: request.queryEmbedding.length, vector: request.queryEmbedding });
    const topK = Math.max(1, Math.min(request.topK ?? 10, 100));

    const { rows } = await this.config.pool.query<{
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

  async healthCheck(): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    try {
      await this.config.pool.query('SELECT 1');
      return {
        healthy: true,
        details: {
          provider: this.config.provider ?? 'postgres',
          namespace: this.namespace
        }
      };
    } catch (error) {
      return {
        healthy: false,
        details: {
          error: (error as Error).message
        }
      };
    }
  }
}
