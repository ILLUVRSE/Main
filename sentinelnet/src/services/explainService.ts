// sentinelnet/src/services/explainService.ts
/**
 * explainService
 *
 * Returns policy explanation payload including:
 *  - policy metadata (id, name, version, severity, state)
 *  - rule (raw)
 *  - recent history entries from policy_history
 *  - recent decisions (placeholders) — this implementation does not yet query Kernel audit;
 *    it returns an empty list if Kernel audit is not configured.
 *
 * Later: we can enrich `recentDecisions` by querying Kernel's audit index or by keeping
 * a local materialized copy of policy decisions.
 */

import logger from '../logger';
import policyStore from './policyStore';
import db from '../db';
import { Policy } from '../models/policy';
import { loadConfig } from '../config/env';
import axios from 'axios';

const config = loadConfig();

export interface PolicyHistoryRow {
  id: string;
  policyId: string;
  version: number;
  changes: any;
  editedBy: string | null;
  editedAt: string;
}

export interface PolicyExplain {
  policy: Policy;
  history: PolicyHistoryRow[];
  // recent decisions (attempts to fetch from Kernel audit if configured)
  recentDecisions: any[]; // structured decision envelopes or audit pointers
  note?: string;
}

/**
 * Fetch policy_history rows for a policy id, most recent first, limited to N.
 */
async function fetchPolicyHistory(policyId: string, limit = 10): Promise<PolicyHistoryRow[]> {
  const sql = `
    SELECT id, policy_id, version, changes, edited_by, edited_at
    FROM policy_history
    WHERE policy_id = $1
    ORDER BY edited_at DESC
    LIMIT $2
  `;
  try {
    const res = await db.query(sql, [policyId, limit]);
    return res.rows.map((r: any) => ({
      id: String(r.id),
      policyId: String(r.policy_id),
      version: Number(r.version),
      changes: r.changes,
      editedBy: r.edited_by ?? null,
      editedAt: r.edited_at ? new Date(r.edited_at).toISOString() : new Date().toISOString(),
    }));
  } catch (err) {
    logger.warn('fetchPolicyHistory failed', err);
    return [];
  }
}

/**
 * Try to fetch recent policy decision audit events from Kernel if KERNEL_AUDIT_URL is configured.
 * This is a best-effort helper: Kernel may not support a direct "search by policy" endpoint.
 * We attempt a naive approach: call `/kernel/audit/search` if available (not guaranteed).
 *
 * If Kernel audit URL is not configured or call fails, return an empty array.
 */
async function fetchRecentDecisionsFromKernel(policyId: string, limit = 10): Promise<any[]> {
  const kernelBase = config.kernelAuditUrl || process.env.KERNEL_AUDIT_URL || '';
  if (!kernelBase) {
    return [];
  }

  // Try a best-effort search endpoint; this will quietly return [] if not available.
  try {
    // Example: /kernel/audit/search?policy=<policyId>&limit=N
    const url = `${kernelBase.replace(/\/$/, '')}/kernel/audit/search`;
    const resp = await axios.post(url, { policy: policyId, limit });
    if (resp?.data?.events) {
      return resp.data.events;
    }
    // Fallback: if kernel exposes a generic search returning array
    if (Array.isArray(resp?.data)) return resp.data;
    // otherwise return empty
    return [];
  } catch (err) {
    logger.debug('fetchRecentDecisionsFromKernel errored (not fatal)', {
      err: (err as Error).message || err,
      policyId,
    });
    return [];
  }
}

/**
 * Main explain function.
 */
export async function explainPolicy(policyId: string): Promise<PolicyExplain | null> {
  // fetch policy
  const policy = await policyStore.getPolicyById(policyId);
  if (!policy) return null;

  // fetch history rows
  const history = await fetchPolicyHistory(policyId, 20);

  // try to get recent decisions from Kernel (best-effort)
  const recentDecisions = await fetchRecentDecisionsFromKernel(policyId, 20);

  const explain: PolicyExplain = {
    policy,
    history,
    recentDecisions,
  };

  if (!recentDecisions.length) {
    explain.note = 'No recent decisions fetched from Kernel (either not configured or Kernel does not expose search).';
  }

  return explain;
}

export default {
  explainPolicy,
};

