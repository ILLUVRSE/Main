// sentinelnet/src/types/decision.ts
/**
 * Shared types for policy decisions and audit references.
 * Used by decisionService, auditWriter, and clients.
 */

/** Kind of decision produced by SentinelNet */
export type DecisionKind = 'allow' | 'deny' | 'quarantine' | 'remediate';

/** Minimal principal summary included in audit payloads */
export interface PrincipalSummary {
  id: string | null;
  type?: string | null;
  roles?: string[];
}

/** Compact evidence reference (e.g., audit:<id>, metrics:<id>) */
export type EvidenceRef = string;

/** Envelope returned by a synchronous check or produced as a policy.decision */
export interface DecisionEnvelope {
  decision: DecisionKind;
  allowed: boolean;
  policyId?: string | null;
  policyVersion?: number | null;
  ruleId?: string | null;
  rationale?: string | null;
  evidence_refs?: EvidenceRef[];
  ts: string;
  // optional principal/context to aid callers
  principal?: PrincipalSummary | null;
  context?: Record<string, any> | null;
}

/** Shape used internally to represent a policy decision to be written to audit */
export interface PolicyDecisionMeta {
  decision: DecisionKind;
  allowed: boolean;
  policyId: string | null;
  policyVersion: number | null;
  ruleId?: string | null;
  rationale?: string | null;
  evidenceRefs?: EvidenceRef[];
  ts?: string | null;
}

