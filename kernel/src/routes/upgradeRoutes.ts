/**
 * kernel/src/routes/upgradeRoutes.ts
 *
 * HTTP endpoints for the multi-sig upgrade workflow (3-of-5 quorum).
 */

import express, { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { query } from '../db';
import { appendAuditEvent } from '../auditStore';
import { evaluateQuorum, getUpgradeMultiSigConfig, validateApprover } from '../internal/multisig';
import { authMiddleware } from '../middleware/auth';
import { getPrincipalFromRequest, Principal, RoleName, Roles, requireAnyAuthenticated, requireRoles } from '../rbac';

const ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = ENV === 'production';

function applyProductionGuards(...middlewares: RequestHandler[]): RequestHandler[] {
  if (!IS_PRODUCTION) return [];
  if (!middlewares.length) return [authMiddleware];
  return [authMiddleware, ...middlewares];
}

function requireRolesInProduction(...roles: RoleName[]): RequestHandler[] {
  return applyProductionGuards(requireRoles(...roles));
}

function requireAuthInProduction(): RequestHandler[] {
  return applyProductionGuards(requireAnyAuthenticated);
}

type UpgradeRow = {
  id: string;
  upgrade_id: string;
  manifest: Record<string, any>;
  status: string;
  submitted_by: string | null;
  submitted_at: string | null;
  applied_at: string | null;
  applied_by: string | null;
};

function mapUpgradeRow(row: any) {
  const upgrade: any = {
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

function resolvePrincipal(req: Request): Principal | undefined {
  const ctxPrincipal =
    (req.authContext?.principal as Principal | undefined) || ((req as any).principal as Principal | undefined);
  if (ctxPrincipal) {
    return ctxPrincipal;
  }
  return getPrincipalFromRequest(req);
}

export default function createUpgradeRouter(): Router {
  const router = express.Router();

  router.post(
    '/',
    ...requireRolesInProduction(Roles.SUPERADMIN, Roles.OPERATOR),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const manifest = req.body?.manifest;
        const submittedByBody = req.body?.submittedBy as string | undefined;
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
        const result = await query<UpgradeRow>(insertSql, [upgradeId, manifest, submittedBy]);
        const upgrade = mapUpgradeRow(result.rows[0]);

        await appendAuditEvent('upgrade.submitted', {
          upgradeId,
          submittedBy,
          manifest,
        });

        return res.status(201).json({ upgrade });
      } catch (err) {
        if ((err as any)?.code === '23505') {
          return res.status(409).json({ error: 'upgrade_exists' });
        }
        return next(err);
      }
    },
  );

  router.post(
    '/:upgradeId/approve',
    ...requireAuthInProduction(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { upgradeId } = req.params;
        const approverId = req.body?.approverId as string | undefined;
        const signature = req.body?.signature as string | undefined;
        const notes = req.body?.notes as string | undefined;

        if (!approverId || typeof approverId !== 'string') {
          return res.status(400).json({ error: 'missing_approver_id' });
        }
        if (!signature || typeof signature !== 'string') {
          return res.status(400).json({ error: 'missing_signature' });
        }

        const config = getUpgradeMultiSigConfig();
        const validation = validateApprover(approverId, config);
        if (!validation.ok) {
          return res.status(400).json({ error: validation.reason });
        }

        const upgradeRes = await query<UpgradeRow>(
          'SELECT id, upgrade_id, manifest, status, submitted_by, submitted_at, applied_at, applied_by FROM upgrades WHERE upgrade_id = $1',
          [upgradeId],
        );
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
        const insertRes = await query(insertSql, [upgradeRow.id, approverId, signature, notes ?? null]);
        const approvalRow = insertRes.rows[0];

        await appendAuditEvent('upgrade.approval', {
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
      } catch (err) {
        if ((err as any)?.code === '23505') {
          return res.status(409).json({ error: 'approver_already_signed' });
        }
        return next(err);
      }
    },
  );

  router.post(
    '/:upgradeId/apply',
    ...requireRolesInProduction(Roles.SUPERADMIN, Roles.OPERATOR),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { upgradeId } = req.params;
        const appliedByBody = req.body?.appliedBy as string | undefined;
        const principal = resolvePrincipal(req);
        const appliedBy = appliedByBody || principal?.id || principal?.roles?.[0] || null;
        if (!appliedBy) {
          return res.status(400).json({ error: 'missing_applied_by' });
        }

        const upgradeRes = await query<UpgradeRow>(
          'SELECT id, upgrade_id, manifest, status, submitted_by, submitted_at, applied_at, applied_by FROM upgrades WHERE upgrade_id = $1',
          [upgradeId],
        );
        if (!upgradeRes.rowCount) {
          return res.status(404).json({ error: 'upgrade_not_found' });
        }
        const upgradeRow = upgradeRes.rows[0];
        if (upgradeRow.status === 'applied') {
          return res.status(409).json({ error: 'upgrade_already_applied' });
        }

        const approvalsRes = await query(
          'SELECT approver_id FROM upgrade_approvals WHERE upgrade_id = $1',
          [upgradeRow.id],
        );
        const config = getUpgradeMultiSigConfig();
        const evaluation = evaluateQuorum(approvalsRes.rows.map((row: any) => String(row.approver_id)), config);
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
        const updateRes = await query(updateSql, [appliedBy, upgradeRow.id]);
        const updatedRow = updateRes.rows[0];
        const upgrade = mapUpgradeRow(updatedRow);

        await appendAuditEvent('upgrade.applied', {
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
      } catch (err) {
        return next(err);
      }
    },
  );

  return router;
}
