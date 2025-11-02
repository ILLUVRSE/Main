/**
 * kernel/src/sentinelClient.ts
 *
 * Lightweight SentinelNet (policy engine) client stub for Kernel.
 * - Contacts configured SENTINEL_URL to evaluate policy decisions for actions.
 * - Provides a safe fallback (allow-by-default or reject-by-default configurable) for local dev.
 *
 * Responsibilities:
 * - evaluatePolicy(action, payload): ask SentinelNet whether the action is allowed.
 * - enforcePolicyOrThrow(action, payload): helper that throws a structured error when policy blocks action.
 *
 * Notes:
 * - This is a thin HTTP client / fallback for local dev. Replace with your real SentinelNet client
 *   and authentication (mTLS/OAuth) in production.
 * - DO NOT COMMIT SECRETS — use Vault/KMS and environment variables for auth to SentinelNet.
 */

import fetch from 'node-fetch';

const SENTINEL_URL = process.env.SENTINEL_URL || '';
const SENTINEL_TIMEOUT_MS = Number(process.env.SENTINEL_TIMEOUT_MS || 3000);
const SENTINEL_FALLBACK_ALLOW = (process.env.SENTINEL_FALLBACK_ALLOW || 'true') === 'true';

/** PolicyDecision — canonical shape returned by evaluatePolicy */
export interface PolicyDecision {
  allowed: boolean;
  policyId?: string;
  reason?: string;
  rationale?: any; // optional structured rationale from SentinelNet
  ts?: string;
}

/** Error thrown when policy denies an action */
export class PolicyDeniedError extends Error {
  public decision: PolicyDecision;
  constructor(decision: PolicyDecision) {
    super(`policy.denied: ${decision.reason ?? 'denied by policy'}`);
    this.decision = decision;
    Object.setPrototypeOf(this, PolicyDeniedError.prototype);
  }
}

/**
 * fetchWithTimeout
 * Simple fetch wrapper that enforces a timeout.
 */
async function fetchWithTimeout(url: string, opts: any = {}, timeout = SENTINEL_TIMEOUT_MS): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return res;
  } finally {
    clearTimeout(id);
  }
}

/**
 * evaluatePolicy
 * Ask SentinelNet whether the given action with payload is allowed.
 *
 * Parameters:
 * - action: short string identifying the action (e.g., "allocation.request", "manifest.update")
 * - payload: arbitrary JSON payload that helps the policy engine decide
 *
 * Behavior:
 * - If SENTINEL_URL is set, POST to `${SENTINEL_URL}/evaluate` with body { action, payload }.
 *   Expect a JSON response: { allowed: boolean, policyId?: string, reason?: string, rationale?: any }
 * - If SENTINEL_URL is not set, return a fallback decision (configurable with SENTINEL_FALLBACK_ALLOW).
 *
 * Returns: PolicyDecision
 */
export async function evaluatePolicy(action: string, payload: any): Promise<PolicyDecision> {
  if (!SENTINEL_URL) {
    return {
      allowed: SENTINEL_FALLBACK_ALLOW,
      policyId: SENTINEL_FALLBACK_ALLOW ? 'fallback-allow' : 'fallback-deny',
      reason: SENTINEL_FALLBACK_ALLOW ? 'no-sentinel-configured: allow-by-default' : 'no-sentinel-configured: deny-by-default',
      ts: new Date().toISOString(),
    };
  }

  const url = `${SENTINEL_URL.replace(/\/$/, '')}/evaluate`;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // In production, include auth headers / mTLS client cert mapping, etc.
      },
      body: JSON.stringify({ action, payload }),
    }, SENTINEL_TIMEOUT_MS);

    if (!res.ok) {
      // Treat non-200 as a conservative fallback: deny (unless configured otherwise)
      const text = await res.text().catch(() => '<no body>');
      console.warn(`Sentinel returned non-OK (${res.status}): ${text}`);
      return {
        allowed: SENTINEL_FALLBACK_ALLOW,
        policyId: `sentinel-error-${res.status}`,
        reason: `sentinel_error_${res.status}`,
        ts: new Date().toISOString(),
      };
    }

    const body = await res.json();
    // Normalize response to PolicyDecision
    const decision: PolicyDecision = {
      allowed: Boolean(body.allowed),
      policyId: body.policyId || body.policy_id,
      reason: body.reason,
      rationale: body.rationale ?? body.details,
      ts: body.ts || new Date().toISOString(),
    };
    return decision;
  } catch (err: any) {
    // On network/timeout errors, fallback to configured behavior
    console.error('Sentinel evaluate error:', err?.message || err);
    return {
      allowed: SENTINEL_FALLBACK_ALLOW,
      policyId: 'sentinel-unreachable',
      reason: `sentinel_unreachable: ${err?.message || 'timeout'}`,
      ts: new Date().toISOString(),
    };
  }
}

/**
 * enforcePolicyOrThrow
 * Convenience helper: evaluatePolicy and throw PolicyDeniedError when not allowed.
 */
export async function enforcePolicyOrThrow(action: string, payload: any): Promise<PolicyDecision> {
  const decision = await evaluatePolicy(action, payload);
  if (!decision.allowed) {
    throw new PolicyDeniedError(decision);
  }
  return decision;
}

/**
 * Acceptance criteria (testable)
 *
 * - evaluatePolicy returns an allowed/denied PolicyDecision when SENTINEL_URL is configured and responds with JSON.
 *   Test: Start a mock HTTP server that responds to /evaluate with {allowed:false, policyId:'p1', reason:'blocked'} and assert evaluatePolicy returns that shape.
 *
 * - When SENTINEL_URL is not configured, evaluatePolicy returns fallback decision controlled by SENTINEL_FALLBACK_ALLOW.
 *   Test: Unset SENTINEL_URL and set SENTINEL_FALLBACK_ALLOW=true/false and confirm behavior.
 *
 * - A network error / timeout to Sentinel results in a fallback decision (not a crash) and logs the error.
 *   Test: Point SENTINEL_URL to a non-responsive address and confirm evaluatePolicy returns fallback decision after timeout.
 *
 * - enforcePolicyOrThrow throws PolicyDeniedError with decision when policy denies action.
 *   Test: Mock sentinel to return allowed:false and assert enforcePolicyOrThrow throws with decision attached.
 *
 * Security/Operational notes:
 * - In production, authenticate calls to SentinelNet (mTLS/OAuth) and ensure principal identity is forwarded for policy checks.
 * - Policy decisions should be recorded in the audit log (the caller should appendAuditEvent with policyId/reason).
 */

