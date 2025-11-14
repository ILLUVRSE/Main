// sentinelnet/src/services/decisionService.ts
import logger from '../logger';
import policyStore from './policyStore';
import evaluator from '../evaluator';
import auditWriter from './auditWriter';
import canary from './canary';
import metrics from '../metrics/metrics';
import { Policy } from '../models/policy';

type ActionCtx = {
  action: string;
  actor?: any;
  resource?: any;
  context?: any;
  requestId?: string | null;
};

export type DecisionKind = 'allow' | 'deny' | 'quarantine' | 'remediate';

export interface DecisionEnvelope {
  decision: DecisionKind;
  allowed: boolean;
  policyId?: string | null;
  policyVersion?: number | null;
  ruleId?: string | null;
  rationale?: string | null;
  evidence_refs?: string[];
  ts: string;
}

/**
 * Choose final decision from matching policies.
 * Priority: deny > quarantine > remediate > allow
 */
function pickFinalDecision(effects: string[]): DecisionKind {
  if (effects.includes('deny')) return 'deny';
  if (effects.includes('quarantine')) return 'quarantine';
  if (effects.includes('remediate')) return 'remediate';
  return 'allow';
}

/**
 * Evaluate an action against active policies.
 * Returns a DecisionEnvelope. This function does not throw for policy denial;
 * it returns a structured decision. Audit emission is attempted but failures
 * do not stop the response.
 */
export async function evaluateAction(ctx: ActionCtx): Promise<DecisionEnvelope> {
  const start = process.hrtime.bigint();
  const ts = new Date().toISOString();
  const data = {
    action: ctx.action,
    actor: ctx.actor,
    resource: ctx.resource,
    context: ctx.context,
    requestId: ctx.requestId ?? ctx.context?.requestId ?? ctx.context?.request_id ?? null,
  };

  try {
    // Fetch active policies (simple model: evaluate all active policies)
    const candidatePolicies: Policy[] = await policyStore.listPolicies({ states: ['active', 'canary'] });

    const matches: {
      policy: any;
      evalResult: any;
      effect: string; // 'allow'|'deny'|'quarantine'|'remediate' (from metadata or default)
    }[] = [];

    for (const p of candidatePolicies) {
      try {
        const res = await evaluator.evaluate(p.rule, data);
        if (res && res.match) {
          if (p.state === 'canary') {
            const shouldApply = canary.shouldApplyCanary(p, {
              requestId: data.requestId,
              context: data.context,
            });
            if (!shouldApply) {
              logger.debug('decisionService: canary match skipped due to sampling', {
                policyId: p.id,
                requestId: data.requestId,
              });
              continue;
            }
          }
          // Determine effect: policy metadata.effect preferred; default to 'deny' when matched.
          const metaEffect =
            p.metadata && typeof p.metadata.effect === 'string' ? String(p.metadata.effect) : null;
          const effect = (metaEffect as string) || 'deny';
          matches.push({ policy: p, evalResult: res, effect });
        }
      } catch (err) {
        logger.warn('policy evaluation error', { policy: p.id, error: (err as Error).message || err });
        // continue evaluating other policies
      }
    }

    if (matches.length === 0) {
      // No policy matched: default allow
      const decision: DecisionEnvelope = {
        decision: 'allow',
        allowed: true,
        ts,
      };

      // Audit the allow decision (no policy matched). Not required but useful.
      try {
        await auditWriter.appendPolicyDecision(null, data, {
          decision: 'allow',
          allowed: true,
          policyId: null,
          policyVersion: null,
          rationale: 'no_matching_policy',
          evidenceRefs: [],
          ts,
        });
      } catch (err) {
        logger.warn('audit append failed for no-match decision', err);
      }

      metrics.incrementDecision(decision.decision);
      return decision;
    }

    // Build list of effects and pick final
    const effects = matches.map((m) => m.effect);
    const finalDecision = pickFinalDecision(effects);
    const allowed = finalDecision === 'allow';

    // Make a rationale that summarizes matches
    const rationaleParts = matches.map((m) => {
      const p = m.policy;
      const explanation =
        (m.evalResult && (m.evalResult.explanation || JSON.stringify(m.evalResult.evidence || {}))) ||
        'matched';
      return `${p.name}@v${p.version}(${p.id}) => effect=${m.effect} severity=${p.severity} explanation=${explanation}`;
    });

    const rationale = rationaleParts.join(' | ');

    // Prepare envelope
    // Choose the "primary" policy for metadata: prefer highest severity matched policy
    const severityRank: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    matches.sort((a, b) => (severityRank[b.policy.severity] || 0) - (severityRank[a.policy.severity] || 0));
    const primary = matches[0];

    const envelope: DecisionEnvelope = {
      decision: finalDecision,
      allowed,
      policyId: primary.policy.id,
      policyVersion: primary.policy.version,
      ruleId: primary.policy.metadata?.ruleId || null,
      rationale,
      evidence_refs: [], // filled after audit append if available
      ts,
    };

    // Attempt to write out audit event and capture returned reference (if any)
    try {
      const auditRef = await auditWriter.appendPolicyDecision(primary.policy.id, data, {
        decision: finalDecision,
        allowed,
        policyId: primary.policy.id,
        policyVersion: primary.policy.version,
        ruleId: primary.policy.metadata?.ruleId || null,
        rationale,
        evidenceRefs: [], // for now empty; auditWriter may include references
        ts,
      });

      if (auditRef) {
        envelope.evidence_refs = [`audit:${auditRef}`];
      }
    } catch (err) {
      logger.warn('failed to append policy decision audit event', err);
      // don't fail the API response if audit fails
    }

    metrics.incrementDecision(envelope.decision);
    return envelope;
  } catch (err) {
    logger.error('decisionService.evaluateAction fatal error', err);
    // On unexpected errors, be conservative: allow with note
    const fallback = {
      decision: 'allow',
      allowed: true,
      rationale: `evaluator_error: ${(err as Error).message || err}`,
      ts,
    };
    metrics.incrementDecision(fallback.decision);
    return fallback;
  } finally {
    const durationNs = Number(process.hrtime.bigint() - start);
    metrics.observeCheckLatency(durationNs / 1_000_000_000);
  }
}

export default {
  evaluateAction,
};
