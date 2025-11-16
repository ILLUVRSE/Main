/**
 * memory-layer/service/worker/vectorWorker.ts
 *
 * Worker that replays / processes entries in memory_vectors with status != 'completed'.
 *
 * Enhancements:
 *  - Emits metrics (processed, errors)
 *  - Adds tracing spans around adapter calls and updates
 *  - Updates vector queue depth metric after processing a batch
 *
 * Usage:
 *   import { processBatch, startPolling } from './worker/vectorWorker';
 */

import { PoolClient } from 'pg';
import { getPool } from '../db';
import { VectorDbAdapter } from '../vector/vectorDbAdapter';
import type { VectorWriteResult } from '../vector/vectorDbAdapter';

// Observability
import metricsModule from '../observability/metrics';
import tracing from '../observability/tracing';

type MemoryVectorRow = {
  id: string;
  memory_node_id: string;
  provider: string;
  namespace: string;
  embedding_model: string;
  dimension: number;
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

    // Select rows that are not completed, lock them so other workers skip them.
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
      // Ensure queue depth metric is updated (zero for this namespace slice won't be exact but helps)
      try {
        const qRes = await client.query<{ count: string }>('SELECT namespace, count(1) AS count FROM memory_vectors WHERE status = \'pending\' GROUP BY namespace');
        for (const r of qRes.rows) {
          try {
            metricsModule.metrics.vectorQueue.setDepth(Number(r.count), { provider: 'postgres', namespace: (r as any).namespace });
          } catch {}
        }
      } catch {
        // ignore queue depth errors
      }
      return 0;
    }

    for (const row of rows) {
      const id = row.id;
      try {
        // Validate vector_data
        if (!Array.isArray(row.vector_data) || !row.vector_data.length) {
          const msg = 'missing or invalid vector_data';
          await client.query(`UPDATE memory_vectors SET status = 'error', error = $2, updated_at = now() WHERE id = $1`, [id, msg]);
          console.warn(`[vectorWorker] row ${id} has invalid vector_data; marked error`);
          try {
            metricsModule.metrics.vectorWorker.workerError(msg);
            metricsModule.metrics.vectorQueue.workerError(msg);
          } catch {}
          continue;
        }

        // Build embedding payload
        const embedding = {
          model: row.embedding_model,
          dimension: row.dimension ?? row.vector_data.length,
          vector: row.vector_data,
          namespace: row.namespace
        };

        // Create a span for this upsert attempt
        await tracing.withSpan(`vectorWorker.upsert:${id}`, async (span) => {
          try {
            // Attach memory node id to span
            tracing.attachMemoryNodeToSpan(row.memory_node_id);
            span.setAttribute('vector.namespace', row.namespace);
            span.setAttribute('vector.provider', row.provider);
            span.setAttribute('vector.memory_node_id', row.memory_node_id);

            // Attempt upsert via adapter. Inject trace context into any outgoing HTTP calls the adapter makes.
            // If adapter supports a headers param, it should accept tracing.injectTraceToCarrier.
            let writeResult: VectorWriteResult;
            try {
              // Some adapters may accept a trace carrier in metadata — attempt to inject
              const carrier: Record<string, unknown> = {};
              tracing.injectTraceToCarrier(carrier);

              // If adapter supports carrying headers via metadata param, we add it
              const metadata = {
                ...(row.metadata ?? {}),
                traceCarrier: carrier
              };

              writeResult = await vectorAdapter.upsertEmbedding({
                memoryNodeId: row.memory_node_id,
                embeddingId: row.external_vector_id ?? undefined,
                embedding,
                metadata
              });
            } catch (err) {
              // Adapter-level failure: mark as error with message and continue to next row.
              const msg = (err as Error).message || String(err);
              await client.query(`UPDATE memory_vectors SET status = 'error', error = $2, updated_at = now() WHERE id = $1`, [id, `adapter_error: ${msg}`]);
              console.error(`[vectorWorker] adapter upsert failed for ${id}: ${msg}`);
              try {
                metricsModule.metrics.vectorWorker.workerError(msg);
                metricsModule.metrics.vectorWrite.failure({ provider: row.provider, namespace: row.namespace, error: msg });
              } catch {}
              return;
            }

            // On success, update status and external_vector_id (if provided)
            const externalRef = writeResult.externalVectorId ?? null;
            await client.query(
              `UPDATE memory_vectors SET status = 'completed', external_vector_id = $2, error = NULL, updated_at = now() WHERE id = $1`,
              [id, externalRef]
            );
            console.info(`[vectorWorker] processed ${id} -> externalRef=${externalRef}`);
            try {
              metricsModule.metrics.vectorQueue.workerProcessed({ result: 'completed' });
              metricsModule.metrics.vectorWrite.success({ provider: row.provider, namespace: row.namespace });
            } catch {}
          } catch (rowErr) {
            // Per-row unexpected error: set status=error and continue
            const msg = (rowErr as Error).message || String(rowErr);
            try {
              await client.query(`UPDATE memory_vectors SET status = 'error', error = $2, updated_at = now() WHERE id = $1`, [id, `worker_error: ${msg}`]);
            } catch (uerr) {
              console.error(`[vectorWorker] failed to mark row ${id} as error:`, (uerr as Error).message || uerr);
            }
            try {
              metricsModule.metrics.vectorWorker.workerError(msg);
            } catch {}
            console.error(`[vectorWorker] unexpected error processing ${id}: ${msg}`);
          }
        }, { attributes: { 'memory_vector_id': id, 'memory_node_id': row.memory_node_id } });
      } catch (rowErr) {
        // Outer-catch: if updating the DB or metrics failed unexpectedly, mark as error and continue
        const msg = (rowErr as Error).message || String(rowErr);
        try {
          await client.query(`UPDATE memory_vectors SET status = 'error', error = $2, updated_at = now() WHERE id = $1`, [id, `worker_error: ${msg}`]);
        } catch {
          // If even marking failed, log and continue
          console.error(`[vectorWorker] fatal failed to mark ${id} as error: ${msg}`);
        }
        try {
          metricsModule.metrics.vectorWorker.workerError(msg);
        } catch {}
        console.error(`[vectorWorker] unexpected outer error for ${id}: ${msg}`);
      }
    }

    await client.query('COMMIT');

    // Update queue depth metrics for namespaces we know about (simple snapshot)
    try {
      const qRes = await getPool().query<{ namespace: string; count: string }>(
        `SELECT namespace, count(1) AS count FROM memory_vectors WHERE status = 'pending' GROUP BY namespace`
      );
      for (const r of qRes.rows) {
        try {
          metricsModule.metrics.vectorQueue.setDepth(Number(r.count), { provider: 'postgres', namespace: r.namespace });
        } catch {}
      }
    } catch {
      // ignore queue depth errors
    }

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
 * Returns a stop function that will clear the interval.
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
      // If no rows processed, this is quiet; otherwise log.
      if (count > 0) {
        console.info(`[vectorWorker] processed ${count} rows`);
      }
    } catch (err) {
      console.error('[vectorWorker] poll error:', (err as Error).message || err);
    } finally {
      isProcessing = false;
    }
  };

  const handle = setInterval(tick, intervalMs);
  // run immediately once
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
 * CLI entry: one-shot or polling mode depending on VECTOR_WORKER_POLL env.
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
        // graceful shutdown
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

