/**
 * kernel/src/embedding/vecdb.ts
 *
 * Minimal abstraction for storing and querying embeddings associated with
 * MemoryNodes. The default implementation is an in-memory vector store used
 * by tests and local development. Production deployments can supply a
 * `VECTOR_DB_ENDPOINT` to enable a remote connector.
 */

import fetch from 'node-fetch';

export interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, any> | null;
}

export interface VectorStore {
  upsertEmbedding(id: string, vector: number[], metadata?: Record<string, any> | null): Promise<void>;
  query(vector: number[], topK: number): Promise<VectorMatch[]>;
}

type EmbeddingRecord = { vector: number[]; metadata?: Record<string, any> | null };

function cosineSimilarity(a: number[], b: number[]): number {
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
export class InMemoryVectorStore implements VectorStore {
  private store: Map<string, EmbeddingRecord> = new Map();

  async upsertEmbedding(id: string, vector: number[], metadata?: Record<string, any> | null): Promise<void> {
    if (!Array.isArray(vector) || !vector.length) {
      throw new Error('vector must be a non-empty array');
    }
    this.store.set(id, { vector: vector.map((v) => Number(v)), metadata: metadata || null });
  }

  async query(vector: number[], topK: number): Promise<VectorMatch[]> {
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

/**
 * HttpVectorStore forwards operations to an HTTP endpoint that exposes a
 * minimal REST API (`PUT /embeddings/:id` and `POST /query`).
 */
export class HttpVectorStore implements VectorStore {
  constructor(private baseUrl: string, private apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async upsertEmbedding(id: string, vector: number[], metadata?: Record<string, any> | null): Promise<void> {
    const url = `${this.baseUrl}/embeddings/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ id, vector, metadata: metadata ?? null }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Vector DB upsert failed (${res.status}): ${text || res.statusText}`);
    }
  }

  async query(vector: number[], topK: number): Promise<VectorMatch[]> {
    const url = `${this.baseUrl}/query`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ vector, topK }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Vector DB query failed (${res.status}): ${text || res.statusText}`);
    }
    const payload = (await res.json()) as { matches?: VectorMatch[] };
    return Array.isArray(payload.matches) ? payload.matches : [];
  }
}

let sharedStore: VectorStore | null = null;

export interface VectorStoreConfig {
  provider: 'memory' | 'http';
  endpoint?: string;
  apiKey?: string;
}

export function createVectorStore(config?: Partial<VectorStoreConfig>): VectorStore {
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

export function getVectorStore(): VectorStore {
  if (!sharedStore) {
    sharedStore = createVectorStore();
  }
  return sharedStore;
}

export function setVectorStore(store: VectorStore | null) {
  sharedStore = store;
}

