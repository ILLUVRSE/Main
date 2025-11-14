"use strict";
/**
 * kernel/src/internal/multisig.ts
 *
 * Helpers for evaluating 3-of-5 multi-sig approval workflows.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUpgradeMultiSigConfig = getUpgradeMultiSigConfig;
exports.validateApprover = validateApprover;
exports.evaluateQuorum = evaluateQuorum;
const DEFAULT_APPROVERS = ['approver-1', 'approver-2', 'approver-3', 'approver-4', 'approver-5'];
const DEFAULT_REQUIRED = 3;
function parseApproverList(raw) {
    if (!raw)
        return [...DEFAULT_APPROVERS];
    const entries = raw
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    return entries.length ? entries : [...DEFAULT_APPROVERS];
}
function parseRequired(raw, approverCount) {
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 0) {
        return Math.min(DEFAULT_REQUIRED, approverCount || DEFAULT_APPROVERS.length);
    }
    return Math.min(Math.max(1, Math.floor(num)), approverCount || DEFAULT_APPROVERS.length);
}
function getUpgradeMultiSigConfig() {
    const approvers = parseApproverList(process.env.UPGRADE_APPROVER_IDS);
    const required = parseRequired(process.env.UPGRADE_REQUIRED_APPROVALS, approvers.length);
    return {
        approvers,
        required,
    };
}
function validateApprover(approverId, config = getUpgradeMultiSigConfig()) {
    if (!approverId || typeof approverId !== 'string') {
        return { ok: false, reason: 'invalid_approver_id' };
    }
    if (!config.approvers.includes(approverId)) {
        return { ok: false, reason: 'approver_not_authorized' };
    }
    return { ok: true };
}
function evaluateQuorum(approvalApproverIds, config = getUpgradeMultiSigConfig()) {
    const allowed = new Set(config.approvers);
    const unique = new Set();
    const invalid = [];
    for (const approverId of approvalApproverIds) {
        if (!approverId)
            continue;
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
