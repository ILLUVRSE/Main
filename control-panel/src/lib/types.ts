export type UpgradeStatus = 'pending' | 'active' | 'applied' | 'failed' | 'rejected';

export type Approval = {
  id: string;
  upgradeId: string;
  approverId: string;
  approverName?: string;
  signature: string;
  notes?: string;
  createdAt: string;
};

export type SentinelVerdict = {
  allowed: boolean;
  policyId?: string;
  rationale?: string;
  ts: string;
};

export type ReasoningTraceNode = {
  id: string;
  type: string;
  summary: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type AuditEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  ts: string;
  hash?: string;
  prevHash?: string;
  signature?: string;
};

export type Upgrade = {
  id: string;
  title: string;
  description?: string;
  manifest: Record<string, unknown>;
  manifestHash: string;
  sourceBranch?: string;
  author: string;
  createdAt: string;
  status: UpgradeStatus;
  ciStatus: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  approvalsRequired: number;
  approvals: Approval[];
  sentinelVerdict?: SentinelVerdict;
  reasoningTraceRootId?: string;
  auditTrail?: AuditEvent[];
  emergency?: boolean;
};
