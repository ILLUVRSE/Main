// sentinelnet/src/routes/check.ts
import { Router, Request, Response } from 'express';
import logger from '../logger';
import decisionService from '../services/decisionService';

const router = Router();

/**
 * POST /
 * Body: { action, actor?, resource?, context? }
 * Response: decision envelope:
 * {
 *   decision: "allow" | "deny" | "quarantine" | "remediate",
 *   policyId?: string,
 *   policyVersion?: number,
 *   ruleId?: string,
 *   rationale?: string,
 *   evidence_refs?: string[],
 *   ts?: string
 * }
 */
router.post('/', async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const action = typeof body.action === 'string' ? body.action : undefined;
  const actor = body.actor;
  const resource = body.resource;
  const context = body.context;

  if (!action) {
    return res.status(400).json({ error: 'action is required' });
  }

  try {
    // The decisionService is responsible for running evaluation,
    // emitting audit/policy.decision events, and returning the decision envelope.
    const decision = await decisionService.evaluateAction({
      action,
      actor,
      resource,
      context,
    });

    return res.json(decision);
  } catch (err: any) {
    logger.error('sentinel check failed', err);
    // If the decisionService throws a policy.denied-like error, surface it appropriately.
    if (err?.decision && typeof err.decision === 'object') {
      // structured error emitted by decisionService - map to 403
      return res.status(403).json({ error: 'policy.denied', decision: err.decision });
    }
    return res.status(500).json({ error: err?.message || 'internal_server_error' });
  }
});

export default router;

