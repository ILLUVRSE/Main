// sentinelnet/src/event/consumer.ts
/**
 * Simple audit event consumer (polling-based)
 *
 * For a first-cut implementation we poll Kernel's audit search endpoint:
 *   POST /kernel/audit/search
 * with body { time_min, limit }
 *
 * The consumer keeps a lastSeen timestamp and polls every SENTINEL_POLL_INTERVAL_MS.
 * For production you should replace this with a real Kafka/Redpanda consumer that
 * subscribes to the `audit-events` topic for low-latency streaming.
 *
 * Usage:
 *   const stop = startConsumer(async (event) => { await handler(event); });
 *   ...
 *   await stop();
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../logger';
import { loadConfig } from '../config/env';

const config = loadConfig();
const POLL_INTERVAL_MS = Number(process.env.SENTINEL_POLL_INTERVAL_MS || 2000);
const POLL_LIMIT = Number(process.env.SENTINEL_POLL_LIMIT || 100);

function makeAxios(): AxiosInstance | null {
  const kernelBase = config.kernelAuditUrl || process.env.KERNEL_AUDIT_URL || '';
  if (!kernelBase) {
    logger.warn('event.consumer: no KERNEL_AUDIT_URL configured; consumer will not start');
    return null;
  }
  return axios.create({
    baseURL: kernelBase.replace(/\/$/, ''),
    timeout: 15_000,
    validateStatus: (s) => s >= 200 && s < 500,
  });
}

let running = false;
let timer: NodeJS.Timeout | null = null;

/**
 * Start polling the Kernel audit search for new events and call the provided handler.
 * The handler is invoked for each event in order (best-effort).
 *
 * Returns a function to stop the consumer.
 */
export function startConsumer(handler: (ev: any) => Promise<void>, opts?: { since?: string; intervalMs?: number; limit?: number }) {
  const axiosInstance = makeAxios();
  if (!axiosInstance) {
    throw new Error('KERNEL_AUDIT_URL not configured');
  }
  if (running) {
    throw new Error('consumer already running');
  }
  running = true;
  const intervalMs = opts?.intervalMs ?? POLL_INTERVAL_MS;
  const pollLimit = opts?.limit ?? POLL_LIMIT;
  let lastSeen = opts?.since ?? new Date().toISOString();

  async function pollOnce() {
    try {
      // Query the kernel audit search for events since lastSeen
      const body = {
        time_min: lastSeen,
        limit: pollLimit,
        // optionally we can filter event types if desired; keep generic
      };

      const resp = await axiosInstance.post('/kernel/audit/search', body).catch((e) => {
        logger.warn('event.consumer: kernel audit search request failed', { err: (e as Error).message || e });
        return null;
      });

      if (!resp || resp.status !== 200) {
        // nothing to do
        return;
      }

      // Kernel may return shape { events: [...] } or plain array
      const events = Array.isArray(resp.data) ? resp.data : resp.data?.events ?? [];
      if (!events || !events.length) {
        return;
      }

      // Sort events by timestamp if available to ensure order
      events.sort((a: any, b: any) => {
        const ta = (a.ts || a.createdAt || a.ts) || '';
        const tb = (b.ts || b.createdAt || b.ts) || '';
        if (!ta && !tb) return 0;
        return String(ta) < String(tb) ? -1 : String(ta) > String(tb) ? 1 : 0;
      });

      for (const ev of events) {
        try {
          // call handler
          // Handler should be resilient and idempotent if possible
          // We do not await serially forever; we await so ordering is preserved
          await handler(ev);
        } catch (err) {
          logger.warn('event.consumer: handler failed for event (continuing)', { id: ev?.id, err: (err as Error).message || err });
          // Do not throw — continue processing next events
        }

        // Update lastSeen to event timestamp if present; else use now
        const evTs = ev?.ts ?? ev?.createdAt ?? new Date().toISOString();
        lastSeen = evTs;
      }
    } catch (err) {
      logger.warn('event.consumer: unexpected polling error', { err: (err as Error).message || err });
    }
  }

  async function loop() {
    if (!running) return;
    try {
      await pollOnce();
    } finally {
      if (running) {
        timer = setTimeout(loop, intervalMs);
      }
    }
  }

  // start immediate
  loop().catch((e) => logger.warn('event.consumer: initial loop error', { err: (e as Error).message || e }));

  // return stop function
  return async function stop() {
    running = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    logger.info('event.consumer stopped');
  };
}

export default {
  startConsumer,
};
