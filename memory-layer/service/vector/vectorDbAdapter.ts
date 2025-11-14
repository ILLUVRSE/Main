import type { EmbeddingPayload, SearchRequest } from '../types';

export interface VectorDbConfig {
  provider?: string;
  endpoint?: string;
  apiKey?: string;
  namespace?: string;
}

export interface VectorWriteResult {
  status: 'queued' | 'completed';
  externalVectorId?: string | null;
}

export interface VectorSearchResult {
  memoryNodeId: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export class VectorDbAdapter {
  constructor(private readonly config: VectorDbConfig) {}

  async upsertEmbedding(params: {
    memoryNodeId: string;
    embeddingId?: string | null;
    embedding: EmbeddingPayload;
    metadata?: Record<string, unknown>;
  }): Promise<VectorWriteResult> {
    if (!params.embedding?.vector?.length) {
      throw new Error('Embedding vector is required for upsert.');
    }

    // TODO: call actual provider SDK/API. Placeholder logs so engineers
    // know where to integrate the vector write.
    console.info('[VectorDbAdapter] upsertEmbedding placeholder', {
      provider: this.config.provider,
      namespace: params.embedding.namespace ?? this.config.namespace,
      memoryNodeId: params.memoryNodeId
    });

    return {
      status: this.config.provider ? 'queued' : 'completed',
      externalVectorId: params.embeddingId ?? null
    };
  }

  async search(request: SearchRequest): Promise<VectorSearchResult[]> {
    if (!request.queryEmbedding?.length) {
      throw new Error('queryEmbedding is required.');
    }

    console.info('[VectorDbAdapter] search placeholder', {
      provider: this.config.provider,
      namespace: request.namespace ?? this.config.namespace,
      topK: request.topK ?? 10
    });

    // Return empty list until a provider implementation is wired up.
    return [];
  }

  async healthCheck(): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    // Real implementations should ping the provider here.
    return {
      healthy: true,
      details: {
        provider: this.config.provider ?? 'in-memory',
        namespace: this.config.namespace
      }
    };
  }
}
