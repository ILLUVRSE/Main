
import { Pool } from 'pg';
import { newDb } from 'pg-mem';
import { DbQueue } from '../../src/queue/db-queue';
import { EmbeddingProducer } from '../../src/embeddings/producer';
import { LocalMockEmbeddingProvider } from '../../src/embeddings/local-mock-provider';
import { MockVectorDB } from '../../src/vector-db/mock-adapter';
import { IngestWorker, IMetrics } from '../../src/ingest/worker';
import * as fs from 'fs';
import * as path from 'path';

// Define metrics collector for testing
class TestMetrics implements IMetrics {
  latencies: Record<string, number[]> = {};
  counters: Record<string, number> = {};

  recordLatency(name: string, ms: number, tags?: Record<string, string>): void {
    if (!this.latencies[name]) this.latencies[name] = [];
    this.latencies[name].push(ms);
  }

  incrementCounter(name: string, tags?: Record<string, string>): void {
    const key = name + (tags ? JSON.stringify(tags) : '');
    this.counters[key] = (this.counters[key] || 0) + 1;
  }
}

describe('Vector Pipeline Integration', () => {
  let pool: any; // Can be pg.Pool or pg-mem adapter
  let queue: DbQueue;
  let producer: EmbeddingProducer;
  let embedder: LocalMockEmbeddingProvider;
  let vectorDb: MockVectorDB;
  let worker: IngestWorker;
  let metrics: TestMetrics;
  let isMockMode = false;

  beforeAll(async () => {
    // Check if we should run in mock mode (CI default) or real mode
    if (process.env.MODE === 'mock' || !process.env.POSTGRES_URL) {
      console.log('Running in MOCK mode with pg-mem');
      isMockMode = true;
      const db = newDb();

      // pg-mem doesn't support NOW() out of the box correctly in queries unless we register it or it's standard?
      // Actually newDb() supports standard functions.

      const PG = db.adapters.createPg();
      pool = new PG.Pool();

      // Intercept FOR UPDATE because pg-mem might throw on it
      db.public.interceptQueries(q => {
          if (q.includes('FOR UPDATE')) {
              // Strip FOR UPDATE from query
              const newQuery = q.replace(/FOR UPDATE( SKIP LOCKED)?/, '');
              const result = db.public.query(newQuery);
              return result.rows;
          }
          return null;
      });
    } else {
      console.log('Running in REAL mode with Postgres');
      pool = new Pool({
        connectionString: process.env.POSTGRES_URL || 'postgres://test:test@localhost:5432/memory_layer_test'
      });
    }

    // Initialize DB
    queue = new DbQueue(pool, !isMockMode); // Disable skip locked in mock mode
    await queue.init();

    embedder = new LocalMockEmbeddingProvider();
    vectorDb = new MockVectorDB();
    metrics = new TestMetrics();
    // Faster retries for testing
    worker = new IngestWorker(queue, embedder, vectorDb, metrics, { retryBaseMs: 50, pollIntervalMs: 10 });

    worker.start();
  });

  afterAll(async () => {
    worker.stop();
    await pool.end();
  });

  test('Pipeline processes items idempotently', async () => {
    producer = new EmbeddingProducer(queue);
    const testId = 'test-doc-1';

    // Submit item
    await producer.submit(testId, 'Hello world', { type: 'test' });

    // Wait for processing
    await waitForCondition(async () => {
      const results = await vectorDb.search({ vector: await embedder.embed('Hello world'), k: 1 });
      return results.length > 0 && results[0].id === testId;
    }, 5000);

    // Verify written
    let results = await vectorDb.search({ vector: await embedder.embed('Hello world'), k: 1 });
    expect(results[0].id).toBe(testId);

    // Resubmit same item (idempotency check)
    await producer.submit(testId, 'Hello world', { type: 'test' });

    // Wait a bit
    await new Promise(r => setTimeout(r, 500));

    // Should still be one entry effectively (or updated).
    // Since MockVectorDB uses Map, it overwrites.
    results = await vectorDb.search({ vector: await embedder.embed('Hello world'), k: 10 });
    const matches = results.filter(r => r.id === testId);
    expect(matches.length).toBe(1);
  });

  test('Queue fallback and retry logic', async () => {
    const failId = 'fail-doc-1';

    // Mock failure in vector DB
    const originalUpsert = vectorDb.upsert;
    let failCount = 0;
    vectorDb.upsert = async (id, vector, metadata) => {
      if (id === failId && failCount < 2) {
        failCount++;
        throw new Error('Simulated DB failure');
      }
      return originalUpsert.call(vectorDb, id, vector, metadata);
    };

    await producer.submit(failId, 'Retry me', { type: 'retry' });

    // Wait for eventual success
    await waitForCondition(async () => {
      const results = await vectorDb.search({ vector: await embedder.embed('Retry me'), k: 1 });
      return results.length > 0 && results[0].id === failId;
    }, 5000);

    expect(failCount).toBe(2);

    // Restore
    vectorDb.upsert = originalUpsert;
  });

  test('Search SLO Validation', async () => {
    // Load test corpus
    const corpusPath = path.join(__dirname, '../data/test_corpus.json');
    const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

    // Ingest corpus
    console.log('Ingesting corpus...');
    for (const item of corpus) {
      await producer.submit(item.id, item.text, item.metadata);
      // Small delay to ensure timestamp differences if that helps stable sort
      await new Promise(r => setTimeout(r, 10));
      console.log(`Submitted ${item.id}`);
    }

    // Wait for all to be processed
    console.log('Waiting for processing...');
    await waitForCondition(async () => {
      // Check if last item is present
      const lastItem = corpus[corpus.length - 1];
      const results = await vectorDb.search({ vector: await embedder.embed(lastItem.text), k: 1 });
      // console.log('Checking last item:', lastItem.id, 'Found:', results.length > 0 ? results[0].id : 'none');
      return results.length > 0 && results[0].id === lastItem.id;
    }, 15000);

    // Run queries and measure recall
    // Query: "fox dog" -> should match 1 and 2
    const query = "fox dog";
    const queryVec = await embedder.embed(query);

    const start = Date.now();
    const results = await vectorDb.search({ vector: queryVec, k: 5 });
    const searchLatency = Date.now() - start;

    console.log(`Search Latency: ${searchLatency}ms`);
    expect(searchLatency).toBeLessThan(200); // SLO: < 200ms

    // Recall check: expect id '1' or '2' in top results
    const found = results.some(r => r.id === '1' || r.id === '2');
    expect(found).toBe(true);

    // Validate metrics
    // expect(metrics.latencies['vector_write_latency_ms'].length).toBeGreaterThan(0);
  });

});

async function waitForCondition(fn: () => Promise<boolean>, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Timeout waiting for condition');
}
