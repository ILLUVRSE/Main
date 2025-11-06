// kernel/src/sentinelClient.ts
/**
 * Small, testable Sentinel/audit client surface.
 *
 * - Exports a minimal SentinelClient interface.
 * - Exposes `setSentinelClient()` so tests can inject the mock sentinel (or a stub).
 * - Exposes `recordEvent()` helper which production code calls to emit audit events.
 * - Exposes `enforcePolicyOrThrow()` helper and `PolicyDecision` so routes can evaluate policies.
 *
 * Default client is a noop/allowing implementation so production builds do not fail when
 * sentinel integration is not configured. Tests can inject a richer client.
 */

export type SentinelEventPayload = any;

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  [key: string]: any;
}

/**
 * Minimal Sentinel client surface expected by production/tests.
 * - record(type, payload) => void | Promise<void>
 * - enforcePolicy?(name, context) => PolicyDecision | Promise<PolicyDecision>
 *
 * Tests or a real integration may implement `enforcePolicy` to call an external PDP.
 */
export interface SentinelClient {
  record(type: string, payload?: SentinelEventPayload): void | Promise<void>;
  // optional policy evaluation hook (some implementations)
  enforcePolicy?: (policyName: string, ctx?: any) => PolicyDecision | Promise<PolicyDecision>;
}

/**
 * Default client: no-op that logs to console.info and *allows* policy decisions.
 * Safe for local/dev runs.
 */
const defaultClient: SentinelClient = {
  record(type: string, payload?: SentinelEventPayload) {
    try {
      console.info('[sentinel] event', type, payload === undefined ? '' : payload);
    } catch (e) {
      // swallow errors - sentinel must not break main execution path
      // eslint-disable-next-line no-console
      console.warn('[sentinel] failed to record event', e);
    }
  },

  // default policy evaluator: allow everything
  enforcePolicy(_policyName: string, _ctx?: any) {
    return { allowed: true } as PolicyDecision;
  },
};

let client: SentinelClient = defaultClient;

/**
 * setSentinelClient
 * Replace the active client (used by tests to inject a mock).
 */
export function setSentinelClient(c: SentinelClient | null | undefined) {
  client = c || defaultClient;
}

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

/**
 * enforcePolicyOrThrow
 *
 * Evaluate a named policy with an optional context.
 *
 * - If a client.enforcePolicy is provided, call it and use its decision.
 * - If no client.enforcePolicy exists, default to allowing (PolicyDecision { allowed: true }).
 * - If the resulting decision has `allowed === false`, this helper will *throw*
 *   an Error with a `.decision` property so callers can inspect it in a catch block.
 * - Otherwise the function returns the decision.
 *
 * This behavior mirrors how kernel routes are written: they either accept a returned
 * decision or catch a thrown error which includes `.decision`.
 */
export async function enforcePolicyOrThrow(policyName: string, ctx?: any): Promise<PolicyDecision> {
  try {
    const c: any = client as any;
    let decision: PolicyDecision;

    if (typeof c.enforcePolicy === 'function') {
      const maybe = c.enforcePolicy(policyName, ctx);
      decision = maybe && typeof (maybe as Promise<any>).then === 'function' ? await maybe : maybe;
    } else {
      // no policy hook configured -> default allow
      decision = { allowed: true };
    }

    // Normalize decision
    if (!decision || typeof decision.allowed !== 'boolean') {
      // if sentinel returned something unexpected, treat as allowed but log a warning
      console.warn('[sentinel] unexpected decision shape, allowing by default', decision);
      decision = { allowed: true };
    }

    if (decision.allowed === false) {
      const err: any = new Error('policy.denied');
      err.decision = decision;
      throw err;
    }

    return decision;
  } catch (err) {
    // If the sentinel client threw an error that already contains a .decision
    // bubble that up so callers can inspect it. Otherwise rethrow the error.
    if ((err as any)?.decision) {
      throw err;
    }
    // Wrap unknown errors so callers can still detect policy vs non-policy failures.
    const wrapped: any = new Error('sentinel.evaluate_error');
    wrapped.original = err;
    throw wrapped;
  }
}

export default {
  setSentinelClient,
  resetSentinelClient,
  getSentinelClient,
  recordEvent,
  enforcePolicyOrThrow,
} as const;

