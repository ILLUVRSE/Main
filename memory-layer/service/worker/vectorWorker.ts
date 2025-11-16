/**
 * memory-layer/service/worker/vectorWorker.ts
 *
 * Worker that replays / processes entries in memory_vectors with status != 'completed'.
 *
 * Behavior:
 *  - Grabs a small batch via SELECT ... FOR UPDATE SKIP LOCKED inside a transaction.
 *  - For each row, attempts to call VectorDbAdapter.upsertEmbedding(...) using the stored vector_data.
 *  - On success: sets status='completed', updates external_vector_id (if provided) and updated_at.
 *  - On failure: sets status='error', writes error text and updated_at (so humans can inspect).
 *
 * Exports:
 *  - processBatch(vectorAdapter, limit)
 *  - startPolling(vectorAdapter, { intervalMs, batchSize })
 *
 * CLI:
 *   VECTOR_DB_PROVIDER=postgres npx ts-node memory-layer/service/worker/vectorWorker.ts
 */

import { Readable } from 'stream';
import { getPool } from '../db';
import { VectorDbAdapter } from '../vector/vectorDbAdapter';

type MemoryVectorRow = {
  id: string;
  memory_node_id: string;
  provider: string;
  namespace: string;
  embedding_model: string | null;
  dimension: number | null;
  external_vector_id: string | null;
  status: string;
  error: string | null;
  vector_data: number[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_BATCH_SIZE = 50;

/**
 * Process a batch of pending memory_vectors rows.
 * Returns number of rows processed.
 */
export async function processBatch(vectorAdapter: VectorDbAdapter, limit = DEFAULT_BATCH_SIZE): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const selectRes = await client.query<MemoryVectorRow>(
      `
      SELECT id, memory_node_id, provider, namespace, embedding_model, dimension,
             external_vector_id, status, error, vector_data, metadata, created_at, updated_at
      FROM memory_vectors
      WHERE status != 'completed'
      ORDER BY created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `,
      [limit]
    );

    const rows = selectRes.rows;
    if (!rows.length) {
      await client.query('COMMIT');
      return 0;
    }

    for (const row of rows) {
      const id = row.id;
      try {
        if (!Array.isArray(row.vector_data) || !row.vector_data.length) {
          const msg = 'missing or invalid vector_data';
          await client.query(
            `UPDATE memory_vectors SET status = 'error', error = $2, updated_at = now() WHERE id = $1`,
            [id, msg]
          );
          console.warn(`[vectorWorker] row ${id} has invalid vector_data; marked error`);
          continue;
        }

        // Prepare embedding payload
        const embedding = {
          model: row.embedding_model ?? 'unknown',
          dimension: row.dimension ?? row.vector_data.length,
          vector: row.vector_data,
          namespace: row.namespace
        };

        // Attempt upsert via adapter
        let writeResult;
        try {
          writeResult = await vectorAdapter.upsertEmbedding({
            memoryNodeId: row.memory_node_id,
            embeddingId: row.external_vector_id ?? undefined,
            embedding,
            metadata: row.metadata ?? {}
          });
        } catch (err) {
          const msg = (err as Error).message || String(err);
          await client.query(
            `UPDATE memory_vectors SET status = 'error', error = $2, updated_at = now() WHERE id = $1`,
            [id, `adapter_error: ${msg}`]
          );
          console.error(`[vectorWorker] adapter upsert failed for ${id}: ${msg}`);
          continue;
        }

        // On success, update memory_vectors status and external_vector_id if present
        const externalRef = (writeResult && writeResult.externalVectorId) ? writeResult.externalVectorId : row.external_vector_id;
        await client.query(
          `UPDATE memory_vectors SET status = 'completed', external_vector_id = $2, error = NULL, updated_at = now() WHERE id = $1`,
          [id, externalRef]
        );
        console.info(`[vectorWorker] processed ${id} -> externalRef=${externalRef}`);
      } catch (rowErr) {
        const msg = (rowErr as Error).message || String(rowErr);
        try {
          await client.query(
            `UPDATE memory_vectors SET status = 'error', error = $2, updated_at = now() WHERE id = $1`,
            [id, `worker_error: ${msg}`]
          );
        } catch (uerr) {
          console.error(`[vectorWorker] failed to mark row ${id} as error:`, (uerr as Error).message || uerr);
        }
        console.error(`[vectorWorker] unexpected error processing ${id}: ${msg}`);
      }
    }

    await client.query('COMMIT');
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[vectorWorker] batch failed, transaction rolled back:', (err as Error).message || String(err));
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Start polling loop that runs processBatch periodically.
 * Returns a controller with stop().
 */
export function startPolling(vectorAdapter: VectorDbAdapter, opts?: { intervalMs?: number; batchSize?: number }) {
  const intervalMs = opts?.intervalMs ?? Number(process.env.VECTOR_WORKER_INTERVAL_MS ?? '5000');
  const batchSize = opts?.batchSize ?? Number(process.env.VECTOR_WORKER_BATCH_SIZE ?? String(DEFAULT_BATCH_SIZE));

  let running = true;
  let isProcessing = false;

  const tick = async () => {
    if (!running) return;
    if (isProcessing) return;
    isProcessing = true;
    try {
      const count = await processBatch(vectorAdapter, batchSize);
      if (count > 0) console.info(`[vectorWorker] processed ${count} rows`);
    } catch (err) {
      console.error('[vectorWorker] poll error:', (err as Error).message || err);
    } finally {
      isProcessing = false;
    }
  };

  const handle = setInterval(tick, intervalMs);
  // run immediately
  void tick();

  console.info(`[vectorWorker] started polling every ${intervalMs}ms (batchSize=${batchSize})`);

  return {
    stop: () => {
      running = false;
      clearInterval(handle);
      console.info('[vectorWorker] stopped');
    }
  };
}

/**
 * CLI entry: one-shot or polling depending on VECTOR_WORKER_POLL (default true)
 */
if (require.main === module) {
  (async () => {
    try {
      const adapter = new VectorDbAdapter({
        provider: process.env.VECTOR_DB_PROVIDER,
        endpoint: process.env.VECTOR_DB_ENDPOINT,
        apiKey: process.env.VECTOR_DB_API_KEY,
        namespace: process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory',
        pool: getPool()
      });

      const poll = String(process.env.VECTOR_WORKER_POLL ?? 'true').toLowerCase() === 'true';
      if (poll) {
        const controller = startPolling(adapter, {});
        process.on('SIGINT', () => {
          controller.stop();
          process.exit(0);
        });
        process.on('SIGTERM', () => {
          controller.stop();
          process.exit(0);
        });
      } else {
        const processed = await processBatch(adapter, Number(process.env.VECTOR_WORKER_BATCH_SIZE ?? DEFAULT_BATCH_SIZE));
        console.info(`[vectorWorker] one-shot processed ${processed} rows`);
        process.exit(0);
      }
    } catch (err) {
      console.error('[vectorWorker] fatal error:', (err as Error).message || err);
      process.exit(1);
    }
  })();
}

export default {
  processBatch,
  startPolling
};

