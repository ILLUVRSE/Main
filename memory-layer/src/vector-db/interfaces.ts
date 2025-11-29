
export interface VectorSearchParams {
  vector: number[];
  k: number;
  filter?: Record<string, any>;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata?: Record<string, any>;
}

export interface IVectorDB {
  /**
   * Upserts a vector into the database.
   * Operations should be idempotent.
   * @param id Unique identifier for the vector (e.g., artifactId + nodeId).
   * @param vector The embedding vector.
   * @param metadata Associated metadata.
   */
  upsert(id: string, vector: number[], metadata: Record<string, any>): Promise<void>;

  /**
   * Searches for nearest neighbors.
   * @param params Search parameters.
   */
  search(params: VectorSearchParams): Promise<VectorSearchResult[]>;
}
