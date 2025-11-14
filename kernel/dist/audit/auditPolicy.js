"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSamplingRandom = setSamplingRandom;
exports.evaluateAuditPolicy = evaluateAuditPolicy;
exports.cleanupExpiredAuditEvents = cleanupExpiredAuditEvents;
const db_1 = require("../db");
const DEFAULT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS || 365);
const SAMPLING_RULES = {
    'agent.heartbeat': {
        sampleRate: Number(process.env.AUDIT_SAMPLE_AGENT_HEARTBEAT || 0.1),
        roleOverrides: { superadmin: 1, auditor: 1 },
    },
    'system.healthcheck': {
        sampleRate: Number(process.env.AUDIT_SAMPLE_HEALTHCHECK || 0.05),
    },
};
const CRITICAL_EVENTS = new Set((process.env.AUDIT_CRITICAL_EVENTS || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
    .concat([
    'manifest.update',
    'manifest.signed',
    'agent.spawn',
    'eval.submitted',
    'allocation.request',
    'signer.rotation',
    'reason.trace.fetch',
]));
let randomFn = () => Math.random();
function setSamplingRandom(fn) {
    randomFn = fn;
}
function resolveSampleRate(rule, principal) {
    if (!rule.roleOverrides)
        return rule.sampleRate;
    const roles = Array.isArray(principal?.roles)
        ? principal.roles.map((r) => String(r).toLowerCase())
        : [];
    for (const role of roles) {
        if (rule.roleOverrides[role] !== undefined) {
            return rule.roleOverrides[role];
        }
    }
    return rule.sampleRate;
}
function evaluateAuditPolicy(eventType, principal) {
    const retentionMs = DEFAULT_RETENTION_DAYS > 0 ? DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000 : 0;
    const retentionExpiresAt = retentionMs
        ? new Date(Date.now() + retentionMs).toISOString()
        : null;
    if (CRITICAL_EVENTS.has(eventType)) {
        return { keep: true, sampled: false, retentionExpiresAt };
    }
    const rule = SAMPLING_RULES[eventType];
    if (!rule) {
        return { keep: true, sampled: false, retentionExpiresAt };
    }
    const rate = Math.max(0, Math.min(1, resolveSampleRate(rule, principal)));
    if (rate >= 1) {
        return { keep: true, sampled: false, retentionExpiresAt };
    }
    const keep = randomFn() < rate;
    return { keep, sampled: !keep, retentionExpiresAt };
}
async function cleanupExpiredAuditEvents() {
    const res = await (0, db_1.query)('DELETE FROM audit_events WHERE retention_expires_at IS NOT NULL AND retention_expires_at < now() RETURNING id');
    return res.rowCount || 0;
}
