"use strict";
/**
 * kernel/src/routes/upgradeRoutes.ts
 *
 * HTTP endpoints for the multi-sig upgrade workflow (3-of-5 quorum).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = createUpgradeRouter;
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const auditStore_1 = require("../auditStore");
const multisig_1 = require("../internal/multisig");
const rbac_1 = require("../rbac");
const ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = ENV === 'production';
function applyProductionGuards(...middlewares) {
    return IS_PRODUCTION ? middlewares : [];
}
function requireRolesInProduction(...roles) {
    return applyProductionGuards((0, rbac_1.requireRoles)(...roles));
}
function requireAuthInProduction() {
    return applyProductionGuards(rbac_1.requireAnyAuthenticated);
}
function mapUpgradeRow(row) {
    const upgrade = {
        id: String(row.id),
        upgradeId: row.upgrade_id,
        manifest: row.manifest ?? {},
        status: row.status,
        submittedBy: row.submitted_by ?? null,
        submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
        appliedBy: row.applied_by ?? null,
        appliedAt: row.applied_at ? new Date(row.applied_at).toISOString() : null,
    };
    return upgrade;
}
function resolvePrincipal(req) {
    return req.principal ?? (0, rbac_1.getPrincipalFromRequest)(req);
}
function createUpgradeRouter() {
    const router = express_1.default.Router();
    router.post('/', ...requireRolesInProduction(rbac_1.Roles.SUPERADMIN, rbac_1.Roles.OPERATOR), async (req, res, next) => {
        try {
            const manifest = req.body?.manifest;
            const submittedByBody = req.body?.submittedBy;
            if (!manifest || typeof manifest !== 'object') {
                return res.status(400).json({ error: 'invalid_manifest' });
            }
            const upgradeId = String(manifest.upgradeId ?? '').trim();
            if (!upgradeId) {
                return res.status(400).json({ error: 'missing_upgrade_id' });
            }
            const principal = resolvePrincipal(req);
            const submittedBy = submittedByBody || principal?.id || principal?.roles?.[0] || null;
            const insertSql = `
          INSERT INTO upgrades (upgrade_id, manifest, status, submitted_by)
          VALUES ($1, $2, 'pending', $3)
          RETURNING id, upgrade_id, manifest, status, submitted_by, submitted_at, applied_at, applied_by
        `;
            const result = await (0, db_1.query)(insertSql, [upgradeId, manifest, submittedBy]);
            const upgrade = mapUpgradeRow(result.rows[0]);
            await (0, auditStore_1.appendAuditEvent)('upgrade.submitted', {
                upgradeId,
                submittedBy,
                manifest,
            });
            return res.status(201).json({ upgrade });
        }
        catch (err) {
            if (err?.code === '23505') {
                return res.status(409).json({ error: 'upgrade_exists' });
            }
            return next(err);
        }
    });
    router.post('/:upgradeId/approve', ...requireAuthInProduction(), async (req, res, next) => {
        try {
            const { upgradeId } = req.params;
            const approverId = req.body?.approverId;
            const signature = req.body?.signature;
            const notes = req.body?.notes;
            if (!approverId || typeof approverId !== 'string') {
                return res.status(400).json({ error: 'missing_approver_id' });
            }
            if (!signature || typeof signature !== 'string') {
                return res.status(400).json({ error: 'missing_signature' });
            }
            const config = (0, multisig_1.getUpgradeMultiSigConfig)();
            const validation = (0, multisig_1.validateApprover)(approverId, config);
            if (!validation.ok) {
                return res.status(400).json({ error: validation.reason });
            }
            const upgradeRes = await (0, db_1.query)('SELECT id, upgrade_id, manifest, status, submitted_by, submitted_at, applied_at, applied_by FROM upgrades WHERE upgrade_id = $1', [upgradeId]);
            if (!upgradeRes.rowCount) {
                return res.status(404).json({ error: 'upgrade_not_found' });
            }
            const upgradeRow = upgradeRes.rows[0];
            if (upgradeRow.status === 'applied') {
                return res.status(409).json({ error: 'upgrade_already_applied' });
            }
            const insertSql = `
          INSERT INTO upgrade_approvals (upgrade_id, approver_id, signature, notes)
          VALUES ($1, $2, $3, $4)
          RETURNING id, approver_id, signature, notes, approved_at
        `;
            const insertRes = await (0, db_1.query)(insertSql, [upgradeRow.id, approverId, signature, notes ?? null]);
            const approvalRow = insertRes.rows[0];
            await (0, auditStore_1.appendAuditEvent)('upgrade.approval', {
                upgradeId,
                approverId,
                notes: notes ?? null,
            });
            return res.status(201).json({
                approval: {
                    id: String(approvalRow.id),
                    approverId: approvalRow.approver_id,
                    signature: approvalRow.signature,
                    notes: approvalRow.notes ?? null,
                    approvedAt: approvalRow.approved_at ? new Date(approvalRow.approved_at).toISOString() : null,
                },
            });
        }
        catch (err) {
            if (err?.code === '23505') {
                return res.status(409).json({ error: 'approver_already_signed' });
            }
            return next(err);
        }
    });
    router.post('/:upgradeId/apply', ...requireRolesInProduction(rbac_1.Roles.SUPERADMIN, rbac_1.Roles.OPERATOR), async (req, res, next) => {
        try {
            const { upgradeId } = req.params;
            const appliedByBody = req.body?.appliedBy;
            const principal = resolvePrincipal(req);
            const appliedBy = appliedByBody || principal?.id || principal?.roles?.[0] || null;
            if (!appliedBy) {
                return res.status(400).json({ error: 'missing_applied_by' });
            }
            const upgradeRes = await (0, db_1.query)('SELECT id, upgrade_id, manifest, status, submitted_by, submitted_at, applied_at, applied_by FROM upgrades WHERE upgrade_id = $1', [upgradeId]);
            if (!upgradeRes.rowCount) {
                return res.status(404).json({ error: 'upgrade_not_found' });
            }
            const upgradeRow = upgradeRes.rows[0];
            if (upgradeRow.status === 'applied') {
                return res.status(409).json({ error: 'upgrade_already_applied' });
            }
            const approvalsRes = await (0, db_1.query)('SELECT approver_id FROM upgrade_approvals WHERE upgrade_id = $1', [upgradeRow.id]);
            const config = (0, multisig_1.getUpgradeMultiSigConfig)();
            const evaluation = (0, multisig_1.evaluateQuorum)(approvalsRes.rows.map((row) => String(row.approver_id)), config);
            if (!evaluation.hasQuorum) {
                return res.status(400).json({
                    error: 'insufficient_quorum',
                    approvals: evaluation.uniqueApprovers.length,
                    required: config.required,
                    missing: evaluation.missingApprovals,
                });
            }
            const updateSql = `
          UPDATE upgrades
          SET status = 'applied', applied_at = now(), applied_by = $1, updated_at = now()
          WHERE id = $2
          RETURNING id, upgrade_id, manifest, status, submitted_by, submitted_at, applied_at, applied_by
        `;
            const updateRes = await (0, db_1.query)(updateSql, [appliedBy, upgradeRow.id]);
            const updatedRow = updateRes.rows[0];
            const upgrade = mapUpgradeRow(updatedRow);
            await (0, auditStore_1.appendAuditEvent)('upgrade.applied', {
                upgradeId,
                appliedBy,
                approvers: evaluation.uniqueApprovers,
            });
            return res.status(200).json({
                upgrade,
                quorum: {
                    approvers: evaluation.uniqueApprovers,
                    required: config.required,
                },
            });
        }
        catch (err) {
            return next(err);
        }
    });
    return router;
}
