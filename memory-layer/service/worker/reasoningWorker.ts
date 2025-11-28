/**
 * memory-layer/service/worker/reasoningWorker.ts
 *
 * Worker that replays / processes entries in reasoning_graph_queue with status != 'completed'.
 *
 * Usage:
 *   import { startPolling } from './worker/reasoningWorker';
 */

import { getPool } from '../db';
import fetch from 'node-fetch';
import tracing from '../observability/tracing';
import metricsModule from '../observability/metrics';

type ReasoningQueueRow = {
  id: string;
  memory_node_id: string;
  status: string;
  error: string | null;
  payload: any;
  created_at: string;
  updated_at: string;
};

const DEFAULT_BATCH_SIZE = 50;

/**
 * Process a batch of pending reasoning_graph_queue rows.
 * Returns number of rows processed.
 */
export async function processBatch(limit = DEFAULT_BATCH_SIZE): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Select rows that are pending
    const selectRes = await client.query<ReasoningQueueRow>(
      `
      SELECT id, memory_node_id, status, error, payload, created_at, updated_at
      FROM reasoning_graph_queue
      WHERE status = 'pending'
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

    const reasoningServiceUrl = process.env.REASONING_GRAPH_URL;
    if (!reasoningServiceUrl) {
      console.warn('[reasoningWorker] REASONING_GRAPH_URL not configured; skipping processing');
      await client.query('COMMIT');
      return 0;
    }

    for (const row of rows) {
      const id = row.id;
      try {
        await tracing.withSpan(`reasoningWorker.process:${id}`, async (span) => {
          // Construct ReasonNode payload
          // We map Memory Node creation to an "observation" or "action" node in Reasoning Graph.
          // Spec says: "Memory Layer ... nodes reference memory artifacts"
          const nodePayload = {
            type: 'observation', // or 'event'
            payload: {
              source: 'memory-layer',
              memoryNodeId: row.memory_node_id,
              ...row.payload
            },
            author: 'memory-service',
            metadata: {
              source: 'memory-layer',
              memoryNodeId: row.memory_node_id
            }
          };

          // Call Reasoning Graph Service
          try {
             const res = await fetch(`${reasoningServiceUrl}/reason/node`, {
               method: 'POST',
               body: JSON.stringify(nodePayload),
               headers: { 'Content-Type': 'application/json' },
               timeout: 5000
             } as any); // cast for timeout

             if (!res.ok) {
                const text = await res.text();
                throw new Error(`Reasoning service failed: ${res.status} ${text}`);
             }
          } catch (err: any) {
             // If 4xx, maybe invalid payload, mark error. If 5xx, maybe retry later.
             // For now we mark error to avoid infinite loop on bad payload, but we could implement exponential backoff.
             // If connection refused, we should probably keep it pending or increment retry count.
             // Here we simple set status='error'.
             throw err;
          }

          await client.query(
            `UPDATE reasoning_graph_queue SET status = 'completed', error = NULL, updated_at = now() WHERE id = $1`,
            [id]
          );
        });
      } catch (err) {
        const msg = (err as Error).message || String(err);
        await client.query(
          `UPDATE reasoning_graph_queue SET status = 'error', error = $2, updated_at = now() WHERE id = $1`,
          [id, msg]
        );
        console.error(`[reasoningWorker] failed to process ${id}:`, msg);
      }
    }

    await client.query('COMMIT');
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[reasoningWorker] batch failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Start polling loop.
 */
export function startPolling(opts?: { intervalMs?: number; batchSize?: number }) {
  const intervalMs = opts?.intervalMs ?? Number(process.env.REASONING_WORKER_INTERVAL_MS ?? '5000');
  const batchSize = opts?.batchSize ?? 50;

  let running = true;
  let isProcessing = false;

  const tick = async () => {
    if (!running) return;
    if (isProcessing) return;
    isProcessing = true;
    try {
      const count = await processBatch(batchSize);
      if (count > 0) {
        console.info(`[reasoningWorker] processed ${count} rows`);
      }
    } catch (err) {
      console.error('[reasoningWorker] poll error:', err);
    } finally {
      isProcessing = false;
    }
  };

  const handle = setInterval(tick, intervalMs);
  void tick();

  console.info(`[reasoningWorker] started polling every ${intervalMs}ms`);

  return {
    stop: () => {
      running = false;
      clearInterval(handle);
      console.info('[reasoningWorker] stopped');
    }
  };
}
