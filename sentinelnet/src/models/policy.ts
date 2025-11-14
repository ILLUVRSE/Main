// sentinelnet/src/models/policy.ts
/**
 * Canonical Policy interfaces shared across services/helpers.
 * Having a typed model keeps policyStore, evaluators, and tests aligned.
 */

export type PolicySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type PolicyState = 'draft' | 'simulating' | 'canary' | 'active' | 'deprecated';

export interface PolicyMetadata {
  effect?: 'allow' | 'deny' | 'quarantine' | 'remediate';
  canaryPercent?: number;
  canary_percent?: number;
  ruleId?: string;
  [key: string]: any;
}

export interface Policy {
  id: string;
  name: string;
  version: number;
  severity: PolicySeverity;
  rule: any;
  metadata: PolicyMetadata;
  state: PolicyState;
  createdBy: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface NewPolicyInput {
  name: string;
  severity: PolicySeverity;
  rule: any;
  metadata?: PolicyMetadata;
  createdBy?: string | null;
}

/**
 * Helper to normalize NewPolicyInput, applying defaults used during create flows.
 */
export function createPolicyFromInput(input: NewPolicyInput): Policy {
  const now = new Date().toISOString();
  return {
    id: 'pending',
    name: input.name,
    version: 1,
    severity: input.severity,
    rule: input.rule,
    metadata: input.metadata ?? {},
    state: 'draft',
    createdBy: input.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Helper to project what the next semantic version row should look like.
 */
export function bumpPolicyVersion(policy: Policy, updates: Partial<Policy>): Policy {
  const now = new Date().toISOString();
  return {
    ...policy,
    ...updates,
    version: policy.version + 1,
    updatedAt: now,
  };
}

export default {
  createPolicyFromInput,
  bumpPolicyVersion,
};
