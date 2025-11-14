// sentinelnet/src/services/canary.ts
/**
 * Canary controller
 *
 * Responsible for:
 *  - Deciding whether to enforce (apply) a matched policy for a given request
 *    based on canary sampling percentage.
 *  - Exposing helpers to start/stop canary state and configure percent rollout.
 *
 * Implementation notes:
 *  - Uses policy.metadata.canaryPercent (0-100) to decide sampling.
 *  - Sampling is deterministic per request when requestId exists using a hash,
 *    otherwise uses a random coin flip (still acceptable for early testing).
 *  - Offers startCanary/stopCanary which update policy state via policyStore.
 */

import crypto from 'crypto';
import logger from '../logger';
import policyStore from './policyStore';
import { Policy } from '../models/policy';
import metrics from '../metrics/metrics';

function hashToPercent(value: string): number {
  const h = crypto.createHash('sha256').update(value).digest();
  // use first 4 bytes as uint32
  const val = h.readUInt32BE(0);
  return (val / 0xffffffff) * 100.0;
}

/**
 * Determine whether this request falls into the canary bucket for the policy.
 * @param policy the policy object
 * @param ctx the context (may include requestId)
 */
export function shouldApplyCanary(policy: Policy, ctx?: any): boolean {
  const meta = policy.metadata ?? {};
  const percentRaw = meta?.canaryPercent ?? meta?.canary_percent ?? 0;
  let percent = Number(percentRaw) || 0;
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  if (!percent || percent <= 0) return false;
  if (percent >= 100) return true;

  // Use deterministic sampling if request id available
  const requestId =
    ctx?.requestId ||
    ctx?.context?.requestId ||
    ctx?.context?.request_id ||
    ctx?.context?._audit_meta?.id ||
    null;

  if (requestId) {
    const p = hashToPercent(String(requestId));
    return p < percent;
  }

  // fallback: random sampling
  const r = Math.random() * 100;
  return r < percent;
}

/**
 * Configure a policy to canary state with the provided percent.
 * This sets policy.metadata.canaryPercent and switches state to 'canary'.
 */
export async function startCanary(policyId: string, percent: number, editedBy?: string | null) {
  if (percent <= 0 || percent > 100) {
    throw new Error('percent must be in (0,100]');
  }

  // fetch policy
  const policy = await policyStore.getPolicyById(policyId);
  if (!policy) throw new Error('policy_not_found');

  const updatedMeta = { ...(policy.metadata ?? {}), canaryPercent: percent };
  // set metadata and state -> canary
  const updated = await policyStore.updatePolicyInPlace(policyId, { metadata: updatedMeta, state: 'canary' }, editedBy);
  logger.info('Canary started for policy', { policyId, percent });
  metrics.setCanaryPercent(policyId, percent);
  return updated;
}

/**
 * Stop canary for a policy: optionally activate or revert to draft.
 */
export async function stopCanary(policyId: string, activate: boolean, editedBy?: string | null) {
  const policy = await policyStore.getPolicyById(policyId);
  if (!policy) throw new Error('policy_not_found');

  if (activate) {
    // Move to active state
    const updated = await policyStore.updatePolicyInPlace(policyId, { state: 'active' }, editedBy);
    logger.info('Canary activated into active for policy', { policyId });
    metrics.setCanaryPercent(policyId, 0);
    return updated;
  } else {
    // Revert to draft or previous state; keep metadata but mark deprecated/cancelled
    const updated = await policyStore.updatePolicyInPlace(policyId, { state: 'draft' }, editedBy);
    logger.info('Canary stopped and policy reverted to draft', { policyId });
    metrics.setCanaryPercent(policyId, 0);
    return updated;
  }
}

export default {
  shouldApplyCanary,
  startCanary,
  stopCanary,
};
