
import { IEmbeddingProvider } from './interfaces';
import * as crypto from 'crypto';

export class LocalMockEmbeddingProvider implements IEmbeddingProvider {
  private dimension: number;

  constructor(dimension: number = 1536) {
    this.dimension = dimension;
  }

  async embed(text: string): Promise<number[]> {
    // Generate a deterministic vector based on the hash of the text
    const hash = crypto.createHash('sha256').update(text).digest();
    const vector: number[] = [];

    for (let i = 0; i < this.dimension; i++) {
      // Use bytes from the hash to generate values, cycling through the hash buffer
      const byteVal = hash[i % hash.length];
      // Normalize to [-1, 1] roughly
      const val = (byteVal / 128) - 1;
      vector.push(val);
    }

    // Normalize vector to unit length
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => val / magnitude);
  }
}
