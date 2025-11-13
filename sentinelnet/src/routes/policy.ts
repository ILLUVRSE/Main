// sentinelnet/src/routes/policy.ts
import { Router, Request, Response } from 'express';
import logger from '../logger';
import policyStore from '../services/policyStore';
import explainService from '../services/explainService';
import simulator from '../services/simulator';

const router = Router();

/**
 * POST /
 * Create or update a policy.
 *
 * Body:
 * {
 *   id?: string,           // optional for create, required for update
 *   name: string,
 *   severity: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
 *   rule: object,          // JSONLogic or other evaluator AST
 *   metadata?: object,
 *   simulate?: boolean     // if true, run simulation immediately
 * }
 *
 * Response: { policy }
 */
router.post('/', async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const name = body.name;
  const severity = body.severity;
  const rule = body.rule;
  const metadata = body.metadata ?? {};
  const createdBy = (req as any).principal?.id ?? 'unknown';
  const simulate = Boolean(body.simulate);

  if (!name || !severity || !rule) {
    return res.status(400).json({ error: 'name, severity, and rule are required' });
  }

  try {
    const policy = await policyStore.createPolicy({
      name,
      severity,
      rule,
      metadata,
      createdBy,
    });

    // Optionally run simulation right away
    if (simulate) {
      try {
        const report = await simulator.runSimulation(policy.id, { sampleSize: 500 });
        return res.status(201).json({ policy, simulation: report });
      } catch (simErr) {
        logger.warn('policy created but simulation failed', simErr);
        return res.status(201).json({ policy, simulationError: String(simErr) });
      }
    }

    return res.status(201).json({ policy });
  } catch (err: any) {
    logger.error('failed to create policy', err);
    return res.status(500).json({ error: err?.message || 'internal_server_error' });
  }
});

/**
 * GET /:id/explain
 * Return policy text, rationale, recent decisions and evidence refs.
 */
router.get('/:id/explain', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'policy id required' });

  try {
    const explanation = await explainService.explainPolicy(id);
    if (!explanation) return res.status(404).json({ error: 'policy_not_found' });
    return res.json(explanation);
  } catch (err: any) {
    logger.error('failed to fetch policy explanation', err);
    return res.status(500).json({ error: err?.message || 'internal_server_error' });
  }
});

export default router;

