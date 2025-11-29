
export interface IEmbeddingProvider {
  /**
   * Generates an embedding for the given text.
   * @param text The input text to embed.
   * @returns A promise that resolves to the embedding vector.
   */
  embed(text: string): Promise<number[]>;
}
