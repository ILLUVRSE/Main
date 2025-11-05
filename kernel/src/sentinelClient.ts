/**
 * kernel/src/sentinelClient.ts
 *
 * Small, testable Sentinel/audit client surface.
 *
 * - Exports a minimal SentinelClient interface.
 * - Exposes `setSentinelClient()` so tests can inject the mock sentinel (or a stub).
 * - Exposes `recordEvent()` helper which production code calls to emit audit events.
 *
 * This module intentionally contains a noop/default client so production does not fail
 * when sentinel is not configured. Tests should `setSentinelClient(mockSentinel)` to
 * capture events.
 */

export type SentinelEventPayload = any;

export interface SentinelClient {
  record(type: string, payload?: SentinelEventPayload): void | Promise<void>;
  // Optionally tests/impls can expose helpers like clear() or getEvents(), but not required.
}

/**
 * Default client: no-op that logs to console.info. Safe for local/dev runs.
 */
const defaultClient: SentinelClient = {
  record(type: string, payload?: SentinelEventPayload) {
    try {
      // Keep console output minimal; real production integration should replace this client.
      console.info('[sentinel] event', type, payload === undefined ? '' : payload);
    } catch (e) {
      // swallow errors - sentinel must not break main execution path
      // eslint-disable-next-line no-console
      console.warn('[sentinel] failed to record event', e);
    }
  },
};

let client: SentinelClient = defaultClient;

/**
 * setSentinelClient
 * Replace the active client (used by tests to inject a mock).
 * Accepts a SentinelClient implementation; passing a falsy value resets to default.
 */
export function setSentinelClient(c?: SentinelClient | null) {
  client = (c as SentinelClient) || defaultClient;
}

/**
 * resetSentinelClient
 * Restore the sentinel client to the default no-op implementation.
 * Useful in tests to ensure clean state between cases.
 */
export function resetSentinelClient() {
  client = defaultClient;
}

/**
 * getSentinelClient
 * Return the currently configured client.
 */
export function getSentinelClient(): SentinelClient {
  return client;
}

/**
 * recordEvent
 * Safe helper to emit an event. Production code should call this instead of
 * calling the client directly.
 *
 * This helper catches and logs errors so sentinel failures do not break main flows.
 */
export async function recordEvent(type: string, payload?: SentinelEventPayload): Promise<void> {
  try {
    const res = client.record(type, payload);
    if (res && typeof (res as Promise<void>).then === 'function') {
      await (res as Promise<void>);
    }
  } catch (e) {
    // Do not let sentinel failures break primary flows.
    // eslint-disable-next-line no-console
    console.warn('[sentinel] recordEvent failed:', (e as Error).message || e);
  }
}

export default {
  setSentinelClient,
  resetSentinelClient,
  getSentinelClient,
  recordEvent,
} as const;

