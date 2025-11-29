
import { IVectorDB, VectorSearchParams, VectorSearchResult } from './interfaces';

interface InMemoryItem {
  id: string;
  vector: number[];
  metadata: Record<string, any>;
}

export class MockVectorDB implements IVectorDB {
  private items: Map<string, InMemoryItem> = new Map();

  async upsert(id: string, vector: number[], metadata: Record<string, any>): Promise<void> {
    this.items.set(id, { id, vector, metadata });
  }

  async search(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    const { vector: queryVector, k } = params;
    const results: { id: string; score: number; metadata: any }[] = [];

    for (const item of this.items.values()) {
      const score = this.cosineSimilarity(queryVector, item.vector);
      results.push({ id: item.id, score, metadata: item.metadata });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, k);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
