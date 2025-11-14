// sentinelnet/src/event/handler.ts
/**
 * Handler for audit events consumed by the event consumer.
 *
 * For each incoming audit event we:
 *  - build a compact evaluation context (action, actor, resource, context)
 *  - evaluate all active + canary policies
 *  - for matching policies, determine effect (metadata.effect || 'deny')
 *  - for canary policies, consult canary.shouldApplyCanary to decide enforcement
 *  - append policy.decision audit events (best-effort)
 *
 * This is intentionally simple and best-effort for initial iteration.
 */

import logger from '../logger';
import policyStore from '../services/policyStore';
import evaluator from '../evaluator';
import auditWriter from '../services/auditWriter';
import canary from '../services/canary';
import canaryRollback from '../services/canaryRollback';
import { Policy } from '../models/policy';

function buildEvalDataFromEvent(ev: any) {
  const payload = ev?.payload ?? {};
  return {
    action: payload?.action ?? payload?.type ?? ev?.type ?? null,
    actor: payload?.principal ?? payload?.actor ?? ev?.principal ?? null,
    resource: payload?.resource ?? null,
    context: payload ?? ev,
    _audit_meta: {
      id: ev?.id ?? null,
      eventType: ev?.eventType ?? ev?.type ?? null,
      ts: ev?.ts ?? ev?.createdAt ?? null,
    },
    // include top-level event for traceability
    _raw_event: ev,
  };
}

/**
 * Handle a single audit event: run async detections and emit policy decisions.
 */
export async function handleAuditEvent(ev: any): Promise<void> {
  if (!ev) return;

  try {
    const data = buildEvalDataFromEvent(ev);

    // Fetch active and canary policies
    const policies: Policy[] = await policyStore.listPolicies({ states: ['active', 'canary'] });

    if (!policies.length) {
      logger.debug('handleAuditEvent: no policies configured (active/canary)', { eventId: ev?.id });
      return;
    }

    // Evaluate each policy
    for (const p of policies) {
      try {
        const evalRes = await evaluator.evaluate(p.rule, data);

        if (!evalRes || !evalRes.match) {
          // not matched; continue
          continue;
        }

        // Determine desired effect (from metadata or default to 'deny')
        const metaEffect = p.metadata && typeof p.metadata.effect === 'string' ? String(p.metadata.effect) : null;
        const effect = (metaEffect as string) || 'deny';
        const allowed = effect === 'allow';

        // Determine enforcement: active policies enforce; canary policies enforce based on sampling
        let enforced = false;
        if (p.state === 'active') enforced = true;
        else if (p.state === 'canary') {
          try {
            enforced = !!canary.shouldApplyCanary(p, { requestId: data._audit_meta?.id, context: data.context });
          } catch (err) {
            logger.warn('canary.shouldApplyCanary failed, defaulting to not enforced', { policyId: p.id, err: (err as Error).message || err });
            enforced = false;
          }
        }

        // Build rationale/evidence
        const rationale = evalRes.explanation ?? `matched policy ${p.name}@v${p.version}`;
        const evidenceRefs: string[] = [];
        if (data._audit_meta?.id) {
          evidenceRefs.push(`audit:${data._audit_meta.id}`);
        }

        // Append policy decision audit event (best-effort)
        try {
          const auditId = await auditWriter.appendPolicyDecision(p.id, data, {
            decision: effect as any,
            allowed,
            policyId: p.id,
            policyVersion: p.version,
            ruleId: p.metadata?.ruleId ?? null,
            rationale,
            evidenceRefs,
            ts: new Date().toISOString(),
          });

          logger.info('handleAuditEvent: policy decision emitted', {
            policyId: p.id,
            effect,
            enforced,
            auditId,
            eventId: ev?.id,
          });
        } catch (err) {
          logger.warn('handleAuditEvent: failed to append policy decision', {
            policyId: p.id,
            effect,
            error: (err as Error).message || err,
            eventId: ev?.id,
          });
        }

        if (p.state === 'canary') {
          canaryRollback
            .recordDecision(p, { enforced, allowed, effect })
            .catch((err) =>
              logger.warn('canaryRollback: failed to record decision', {
                policyId: p.id,
                err: (err as Error).message || err,
              }),
            );
        }

        // Optionally: take enforcement action (remediation) here if enforced and effect != allow.
        // For the first cut we only emit audit events and let other components act on them.
      } catch (err) {
        logger.warn('handleAuditEvent: policy evaluation failed (continuing)', {
          policyId: p.id,
          err: (err as Error).message || err,
          eventId: ev?.id,
        });
      }
    }
  } catch (err) {
    logger.error('handleAuditEvent: unexpected error', err);
  }
}

export default {
  handleAuditEvent,
};
