// sentinelnet/test/mockSentinelClient.ts
/**
 * Simple in-process mock sentinel client for unit tests.
 *
 * Exposes:
 *  - setBehavior(fn) to change decision logic
 *  - client.record(type, payload) to capture recorded events
 *  - client.enforcePolicy(policyName, ctx) to return deterministic decisions
 *
 * This mirrors the minimal SentinelClient interface used by kernel/src/sentinel/sentinelClient.ts
 */

import { PolicyDecision, SentinelClient } from '../../kernel/src/sentinel/sentinelClient'; // optional type reuse

type DecisionFn = (policyName: string, ctx?: any) => PolicyDecision | Promise<PolicyDecision>;

let decisionFn: DecisionFn = (policyName: string) => {
  // default behavior: allow unless policyName contains "deny"
  const now = new Date().toISOString();
  if (String(policyName).toLowerCase().includes('deny')) {
    return {
      allowed: false,
      decisionId: `mock:${policyName}:deny`,
      ruleId: 'policy-deny',
      rationale: 'policy-name-matched-deny',
      timestamp: now,
    } as PolicyDecision;
  }
  return {
    allowed: true,
    decisionId: `mock:${policyName}:allow`,
    ruleId: 'policy-allow',
    rationale: 'default-allow',
    timestamp: now,
  } as PolicyDecision;
};

const recorded: Array<{ type: string; payload?: any }> = [];

const mockClient: SentinelClient = {
  record(type: string, payload?: any) {
    recorded.push({ type, payload });
    return Promise.resolve();
  },

  async enforcePolicy(policyName: string, ctx?: any) {
    return await decisionFn(policyName, ctx);
  },
};

export function setBehavior(fn: DecisionFn) {
  decisionFn = fn;
}

export function clearRecorded() {
  recorded.length = 0;
}

export function getRecorded() {
  return recorded.slice();
}

export default mockClient;

