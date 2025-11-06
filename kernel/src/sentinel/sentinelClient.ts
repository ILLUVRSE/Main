// kernel/src/sentinel/sentinelClient.ts
/**
 * Sentinel integration helpers.
 *
 * - Provides a minimal SentinelClient interface that production code can depend on.
 * - Allows tests to inject a mock implementation via setSentinelClient().
 * - Records policy decisions to the audit log for observability and governance.
 */

import { appendAuditEvent } from '../auditStore';

export type SentinelEventPayload = any;

export interface PolicyDecision {
  allowed: boolean;
  decisionId?: string | null;
  policyCheckId?: string | null;
  policyId?: string | null;
  ruleId?: string | null;
  rationale?: string | null;
  reason?: string | null;
  timestamp?: string | null;
  ts?: string | null;
  principal?: any;
  [key: string]: any;
}

export interface SentinelClient {
  record(type: string, payload?: SentinelEventPayload): void | Promise<void>;
  enforcePolicy?: (policyName: string, ctx?: any) => PolicyDecision | Promise<PolicyDecision>;
}

const defaultClient: SentinelClient = {
  record(type: string, payload?: SentinelEventPayload) {
    try {
      console.info('[sentinel] event', type, payload === undefined ? '' : payload);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[sentinel] failed to record event', e);
    }
  },

  enforcePolicy(policyName: string) {
    return {
      allowed: true,
      decisionId: `default-allow:${policyName}`,
      ruleId: 'default-allow',
      rationale: 'sentinel.enforcePolicy not configured',
      timestamp: new Date().toISOString(),
    };
  },
};

let client: SentinelClient = defaultClient;

export function setSentinelClient(c: SentinelClient | null | undefined) {
  client = c || defaultClient;
}

export function resetSentinelClient() {
  client = defaultClient;
}

export function getSentinelClient(): SentinelClient {
  return client;
}

export async function recordEvent(type: string, payload?: SentinelEventPayload): Promise<void> {
  try {
    const res = client.record(type, payload);
    if (res && typeof (res as Promise<void>).then === 'function') {
      await (res as Promise<void>);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[sentinel] recordEvent failed:', (e as Error).message || e);
  }
}

type PrincipalSummary = {
  id: string | null;
  type: string | null;
  roles: string[];
};

type NormalizedDecision = {
  id: string;
  allowed: boolean;
  ruleId: string | null;
  rationale: string | null;
  timestamp: string;
};

async function resolveDecision(maybeDecision: PolicyDecision | Promise<PolicyDecision>): Promise<PolicyDecision> {
  if (maybeDecision && typeof (maybeDecision as Promise<PolicyDecision>).then === 'function') {
    return (await maybeDecision) as PolicyDecision;
  }
  return maybeDecision as PolicyDecision;
}

function ensureString(value: any): string | null {
  if (value === undefined || value === null) return null;
  return String(value);
}

function summarizePrincipal(ctx?: any, decision?: PolicyDecision): PrincipalSummary | null {
  const principal = ctx?.principal ?? decision?.principal ?? ctx?.actor ?? ctx?.user;
  if (!principal) {
    return null;
  }

  if (typeof principal === 'string') {
    return { id: principal, type: 'unknown', roles: [] };
  }

  const id = ensureString(principal.id) || null;
  const type = ensureString(principal.type) || null;
  const roles = Array.isArray(principal.roles)
    ? principal.roles.map((r: any) => String(r)).filter(Boolean)
    : [];

  return { id, type, roles };
}

function normalizeDecision(policyName: string, decision: PolicyDecision): NormalizedDecision {
  const allowed = Boolean(decision?.allowed);
  const fallbackId = `${policyName}:${allowed ? 'allow' : 'deny'}`;

  const id =
    ensureString(decision.decisionId) ||
    ensureString(decision.policyCheckId) ||
    ensureString(decision.id) ||
    ensureString(decision.policyId) ||
    ensureString(decision.policy_id) ||
    fallbackId;

  const ruleId =
    ensureString(decision.ruleId) ||
    ensureString(decision.rule_id) ||
    ensureString(decision.policyRuleId) ||
    ensureString(decision.policyId) ||
    ensureString(decision.policy_id) ||
    null;

  const rationale =
    ensureString(decision.rationale) ||
    ensureString(decision.reason) ||
    ensureString(decision.explanation) ||
    null;

  const ts =
    ensureString(decision.timestamp) ||
    ensureString(decision.ts) ||
    new Date().toISOString();

  return {
    id,
    allowed,
    ruleId,
    rationale,
    timestamp: ts,
  };
}

function summarizeContext(ctx?: any): Record<string, any> | undefined {
  if (!ctx || typeof ctx !== 'object') return undefined;

  const summary: Record<string, any> = {};

  const allocation = ctx.allocation || ctx.resourceAllocation;
  if (allocation && typeof allocation === 'object') {
    summary.allocation = {
      entityId:
        ensureString(allocation.entityId) ||
        ensureString(allocation.entity_id) ||
        null,
      delta: typeof allocation.delta === 'number' ? allocation.delta : Number(allocation.delta ?? 0) || 0,
      pool: ensureString(allocation.pool) || null,
    };
  }

  const manifest = ctx.manifest;
  if (manifest && typeof manifest === 'object') {
    summary.manifestId = ensureString(manifest.id) || ensureString(manifest.manifestId) || null;
  }

  const agent = ctx.agent;
  if (agent && typeof agent === 'object') {
    summary.agentId = ensureString(agent.id) || null;
  }

  const requestId =
    ensureString(ctx.requestId) ||
    ensureString(ctx.request_id) ||
    ensureString(ctx.request?.id);
  if (requestId) {
    summary.requestId = requestId;
  }

  if (typeof ctx.action === 'string') {
    summary.action = ctx.action;
  }

  return Object.keys(summary).length ? summary : undefined;
}

async function auditPolicyDecision(policyName: string, ctx: any, decision: PolicyDecision): Promise<void> {
  const principal = summarizePrincipal(ctx, decision);
  const normalizedDecision = normalizeDecision(policyName, decision);
  const contextSummary = summarizeContext(ctx);

  const payload: Record<string, any> = {
    policy: policyName,
    decision: normalizedDecision,
  };

  if (principal) {
    payload.principal = principal;
  }
  if (contextSummary) {
    payload.context = contextSummary;
  }

  try {
    await appendAuditEvent('policy.decision', payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[sentinel] failed to append policy.decision audit event:', (err as Error).message || err);
  }
}

export async function enforcePolicyOrThrow(policyName: string, ctx?: any): Promise<PolicyDecision> {
  try {
    const c: any = client;
    let decision: PolicyDecision;

    if (typeof c.enforcePolicy === 'function') {
      decision = await resolveDecision(c.enforcePolicy(policyName, ctx));
    } else {
      decision = await resolveDecision(defaultClient.enforcePolicy!(policyName, ctx));
    }

    if (!decision || typeof decision.allowed !== 'boolean') {
      console.warn('[sentinel] unexpected decision shape, allowing by default', decision);
      decision = {
        allowed: true,
        decisionId: `${policyName}:allow`,
        ruleId: 'invalid-decision',
        rationale: 'invalid decision shape from sentinel',
        timestamp: new Date().toISOString(),
      };
    }

    await auditPolicyDecision(policyName, ctx, decision);

    if (decision.allowed === false) {
      const err: any = new Error('policy.denied');
      err.decision = decision;
      throw err;
    }

    return decision;
  } catch (err) {
    if ((err as any)?.decision) {
      throw err;
    }
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
