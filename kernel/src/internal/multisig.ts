/**
 * kernel/src/internal/multisig.ts
 *
 * Helpers for evaluating 3-of-5 multi-sig approval workflows.
 */

export interface MultiSigConfig {
  approvers: string[];
  required: number;
}

export interface MultiSigEvaluation {
  hasQuorum: boolean;
  uniqueApprovers: string[];
  missingApprovals: number;
  invalidApprovers: string[];
}

const DEFAULT_APPROVERS = ['approver-1', 'approver-2', 'approver-3', 'approver-4', 'approver-5'];
const DEFAULT_REQUIRED = 3;

function parseApproverList(raw: string | undefined): string[] {
  if (!raw) return [...DEFAULT_APPROVERS];
  const entries = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return entries.length ? entries : [...DEFAULT_APPROVERS];
}

function parseRequired(raw: string | undefined, approverCount: number): number {
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    return Math.min(DEFAULT_REQUIRED, approverCount || DEFAULT_APPROVERS.length);
  }
  return Math.min(Math.max(1, Math.floor(num)), approverCount || DEFAULT_APPROVERS.length);
}

export function getUpgradeMultiSigConfig(): MultiSigConfig {
  const approvers = parseApproverList(process.env.UPGRADE_APPROVER_IDS);
  const required = parseRequired(process.env.UPGRADE_REQUIRED_APPROVALS, approvers.length);
  return {
    approvers,
    required,
  };
}

export function validateApprover(approverId: string, config: MultiSigConfig = getUpgradeMultiSigConfig()): {
  ok: boolean;
  reason?: string;
} {
  if (!approverId || typeof approverId !== 'string') {
    return { ok: false, reason: 'invalid_approver_id' };
  }
  if (!config.approvers.includes(approverId)) {
    return { ok: false, reason: 'approver_not_authorized' };
  }
  return { ok: true };
}

export function evaluateQuorum(
  approvalApproverIds: string[],
  config: MultiSigConfig = getUpgradeMultiSigConfig(),
): MultiSigEvaluation {
  const allowed = new Set(config.approvers);
  const unique = new Set<string>();
  const invalid: string[] = [];

  for (const approverId of approvalApproverIds) {
    if (!approverId) continue;
    if (!allowed.has(approverId)) {
      invalid.push(approverId);
      continue;
    }
    unique.add(approverId);
  }

  const uniqueApprovers = Array.from(unique.values());
  const hasQuorum = uniqueApprovers.length >= config.required;
  const missingApprovals = hasQuorum ? 0 : Math.max(config.required - uniqueApprovers.length, 0);

  return {
    hasQuorum,
    uniqueApprovers,
    missingApprovals,
    invalidApprovers: invalid,
  };
}
