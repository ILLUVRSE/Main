
import { IEmbeddingProvider } from '../embeddings/interfaces';
import { IVectorDB } from '../vector-db/interfaces';
import { IQueue } from '../queue/interfaces';

// Simple metrics interface to avoid heavy dependencies, can be wired to Prometheus
export interface IMetrics {
  recordLatency(name: string, ms: number, tags?: Record<string, string>): void;
  incrementCounter(name: string, tags?: Record<string, string>): void;
}

export class IngestWorker {
  private queue: IQueue;
  private embedder: IEmbeddingProvider;
  private vectorDb: IVectorDB;
  private running: boolean = false;
  private pollIntervalMs: number = 100;
  private maxRetries: number = 5;
  private metrics?: IMetrics;
  private retryBaseMs: number = 1000;

  constructor(
    queue: IQueue,
    embedder: IEmbeddingProvider,
    vectorDb: IVectorDB,
    metrics?: IMetrics,
    config?: { pollIntervalMs?: number; maxRetries?: number; retryBaseMs?: number }
  ) {
    this.queue = queue;
    this.embedder = embedder;
    this.vectorDb = vectorDb;
    this.metrics = metrics;
    if (config) {
      this.pollIntervalMs = config.pollIntervalMs ?? this.pollIntervalMs;
      this.maxRetries = config.maxRetries ?? this.maxRetries;
      this.retryBaseMs = config.retryBaseMs ?? this.retryBaseMs;
    }
  }

  start() {
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
  }

  private async loop() {
    while (this.running) {
      try {
        const item = await this.queue.dequeue();
        if (item) {
          await this.processItem(item);
        } else {
          await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
        }
      } catch (err) {
        console.error('Worker loop error:', err);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async processItem(item: any) { // using any because of queue item type
    const start = Date.now();
    try {
      // 1. Generate Embedding
      const embedStart = Date.now();
      const vector = await this.embedder.embed(item.content);
      const embedDuration = Date.now() - embedStart;
      this.metrics?.recordLatency('embedding_infer_latency_ms', embedDuration, { artifact_type: item.metadata?.type });

      // 2. Write to Vector DB
      const writeStart = Date.now();
      await this.vectorDb.upsert(item.id, vector, item.metadata);
      const writeDuration = Date.now() - writeStart;
      this.metrics?.recordLatency('vector_write_latency_ms', writeDuration, { region: 'us-east-1', outcome: 'success' });

      // 3. Ack
      await this.queue.ack(item.id);

      const totalDuration = Date.now() - start;
      console.log(`Processed item ${item.id} in ${totalDuration}ms`);

    } catch (err: any) {
      console.error(`Failed to process item ${item.id}:`, err);
      this.metrics?.incrementCounter('vector_write_failure_count', { reason: err.message });

      if (item.attempts >= this.maxRetries) {
        await this.queue.deadLetter(item.id, err.message || 'Max retries exceeded');
      } else {
        const backoffMs = Math.pow(2, item.attempts) * this.retryBaseMs;
        const nextRetry = new Date(Date.now() + backoffMs);
        await this.queue.nack(item.id, nextRetry);
      }
    }
  }
}
