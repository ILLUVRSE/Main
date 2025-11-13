// sentinelnet/src/services/multisigGating.ts
/**
 * multisigGating.ts
 *
 * Lightweight helper to interact with Kernel's multi-sig upgrade workflow.
 * Used to gate high-severity policy activations behind a 3-of-5 approval flow.
 *
 * This module:
 *  - creates an "upgrade" manifest of type `policy_activation`
 *  - can submit approvals (approverId + signature)
 *  - can attempt to apply an upgrade when quorum is reached
 *
 * NOTE: Kernel must expose the upgrade endpoints:
 *   POST /kernel/upgrade
 *   POST /kernel/upgrade/:upgradeId/approve
 *   POST /kernel/upgrade/:upgradeId/apply
 *
 * The module is intentionally minimal: policy activation semantics (how to
 * apply the policy once upgrade is applied) must be implemented by caller.
 */

import axios, { AxiosInstance } from 'axios';
import https from 'https';
import fs from 'fs';
import crypto from 'crypto';
import logger from '../logger';
import { loadConfig } from '../config/env';

const config = loadConfig();

/**
 * Create axios instance with optional mTLS.
 * Looks for KERNEL_URL or KERNEL_API_URL env. Falls back to config.kernelAuditUrl if present.
 */
function makeAxios(): AxiosInstance {
  const base =
    process.env.KERNEL_URL ||
    process.env.KERNEL_API_URL ||
    config.kernelAuditUrl ||
    process.env.KERNEL_AUDIT_URL ||
    '';

  if (!base) {
    logger.warn('multisigGating: no kernel base URL configured (KERNEL_URL/KERNEL_API_URL/KERNEL_AUDIT_URL)');
  }

  const skipMtls = config.devSkipMtls || process.env.DEV_SKIP_MTLS === 'true';
  let httpsAgent: https.Agent | undefined = undefined;
  const certPath = process.env.KERNEL_MTLS_CERT_PATH;
  const keyPath = process.env.KERNEL_MTLS_KEY_PATH;
  const caPath = process.env.KERNEL_MTLS_CA_PATH;

  if (!skipMtls && certPath && keyPath) {
    try {
      const cert = fs.readFileSync(certPath);
      const key = fs.readFileSync(keyPath);
      const ca = caPath ? fs.readFileSync(caPath) : undefined;
      httpsAgent = new https.Agent({
        cert,
        key,
        ca,
        keepAlive: true,
        rejectUnauthorized: Boolean(caPath),
      });
      logger.info('multisigGating: configured mTLS for Kernel comms');
    } catch (err) {
      logger.warn('multisigGating: failed to read mTLS cert/key/ca; falling back to non-mTLS', {
        err: (err as Error).message || err,
      });
    }
  } else {
    if (skipMtls) {
      logger.info('multisigGating: DEV_SKIP_MTLS enabled; not using mTLS');
    }
  }

  const instance = axios.create({
    baseURL: base || undefined,
    httpsAgent,
    timeout: 10000,
    validateStatus: (s) => s >= 200 && s < 500, // let caller inspect non-2xx responses
  });

  return instance;
}

const http = makeAxios();

export interface UpgradeCreateResult {
  upgrade: {
    id: string;
    upgradeId: string;
    manifest: any;
    status: string;
    submittedBy?: string | null;
    submittedAt?: string | null;
  };
}

/**
 * Create an upgrade manifest to represent a policy activation.
 * The manifest should be audited by Kernel and go through the multi-sig flow.
 *
 * manifest fields (recommended):
 *  - upgradeId: string (uuid)   // will be generated if not provided
 *  - type: "policy_activation"
 *  - target: { policyId: string, policyName?: string, version?: number }
 *  - rationale: string
 *  - impact: object
 *  - preconditions: object
 *  - proposedBy: string
 */
export async function createPolicyActivationUpgrade(manifest: any, submittedBy?: string | null): Promise<UpgradeCreateResult> {
  const bodyManifest = Object.assign({}, manifest);
  if (!bodyManifest.upgradeId) {
    bodyManifest.upgradeId = `upgrade-${crypto.randomUUID()}`;
  }
  if (!bodyManifest.type) {
    bodyManifest.type = 'policy_activation';
  }
  if (!bodyManifest.timestamp) {
    bodyManifest.timestamp = new Date().toISOString();
  }

  try {
    const res = await http.post('/kernel/upgrade', { manifest: bodyManifest, submittedBy: submittedBy ?? null });
    if (res.status === 201 && res.data && res.data.upgrade) {
      logger.info('createPolicyActivationUpgrade: created upgrade', { upgradeId: res.data.upgrade.upgradeId });
      return res.data as UpgradeCreateResult;
    }
    // surface kernel error
    const errMsg = `createPolicyActivationUpgrade: unexpected kernel response ${res.status}`;
    logger.warn(errMsg, { body: res.data });
    throw new Error(errMsg);
  } catch (err) {
    logger.error('createPolicyActivationUpgrade failed', err);
    throw err;
  }
}

/**
 * Submit an approval for an upgrade.
 * approverId: the id of the approver (e.g., "ryan" or "approver-1")
 * signature: signed approval payload (caller must collect a signature via KMS/HSM or UI)
 * notes: optional
 */
export async function submitUpgradeApproval(upgradeId: string, approverId: string, signature: string, notes?: string | null) {
  if (!upgradeId || !approverId || !signature) {
    throw new Error('upgradeId, approverId, and signature required');
  }

  try {
    const endpoint = `/kernel/upgrade/${encodeURIComponent(upgradeId)}/approve`;
    const res = await http.post(endpoint, { approverId, signature, notes: notes ?? null });
    if (res.status === 201 && res.data && res.data.approval) {
      logger.info('submitUpgradeApproval: approval recorded', { upgradeId, approverId });
      return res.data.approval;
    }
    // handle 409 or 400
    logger.warn('submitUpgradeApproval: kernel responded', { status: res.status, body: res.data });
    throw new Error(`approval_failed: status=${res.status}`);
  } catch (err) {
    logger.error('submitUpgradeApproval failed', err);
    throw err;
  }
}

/**
 * Attempt to apply an upgrade (will fail if quorum not reached).
 * appliedBy: identity applying the upgrade (e.g., "deployer-1")
 */
export async function applyUpgrade(upgradeId: string, appliedBy?: string) {
  if (!upgradeId) throw new Error('upgradeId required');
  try {
    const endpoint = `/kernel/upgrade/${encodeURIComponent(upgradeId)}/apply`;
    const res = await http.post(endpoint, { appliedBy: appliedBy ?? null });
    if (res.status === 200 && res.data) {
      logger.info('applyUpgrade: upgrade applied', { upgradeId });
      return res.data;
    }
    logger.warn('applyUpgrade: kernel responded', { status: res.status, body: res.data });
    throw new Error(`apply_failed: status=${res.status}`);
  } catch (err) {
    logger.error('applyUpgrade failed', err);
    throw err;
  }
}

/**
 * Query upgrade status via Kernel by making a best-effort request.
 * Kernel's upgrade API returns upgrade objects when fetching list or via DB; there is
 * no single GET /kernel/upgrade/:upgradeId in the current kernel routes, so this helper
 * attempts to call /kernel/upgrade search if available or relies on apply/approve calls' responses.
 *
 * NOTE: If your Kernel exposes a GET endpoint for upgrades, replace this logic to call it.
 */
export async function getUpgradeStatus(upgradeId: string) {
  try {
    // Try probing a GET-like endpoint (not guaranteed)
    const endpoint = `/kernel/upgrade/${encodeURIComponent(upgradeId)}`;
    const res = await http.get(endpoint).catch(() => null);
    if (res && res.status === 200) {
      return res.data;
    }

    // fallback: try search (POST /kernel/upgrade/search) or list; these endpoints are not standard,
    // so we return null for now to indicate no status available.
    logger.debug('getUpgradeStatus: no direct kernel endpoint found for upgrade status', { upgradeId });
    return null;
  } catch (err) {
    logger.warn('getUpgradeStatus error', err);
    return null;
  }
}

export default {
  createPolicyActivationUpgrade,
  submitUpgradeApproval,
  applyUpgrade,
  getUpgradeStatus,
};

