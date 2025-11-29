
import { IQueue } from '../queue/interfaces';

export class EmbeddingProducer {
  private queue: IQueue;

  constructor(queue: IQueue) {
    this.queue = queue;
  }

  /**
   * Submits an artifact for embedding.
   * @param id Unique ID (e.g. artifactId + nodeId)
   * @param text Content to embed
   * @param metadata Additional metadata
   */
  async submit(id: string, text: string, metadata: Record<string, any> = {}): Promise<void> {
    // Normalize input
    const normalizedText = text.trim();
    if (!normalizedText) {
      throw new Error('Content cannot be empty');
    }

    await this.queue.enqueue({
      id,
      content: normalizedText,
      metadata
    });
  }
}
