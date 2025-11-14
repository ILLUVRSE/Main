// sentinelnet/src/routes/policy.ts
import { Router, Request, Response } from 'express';
import logger from '../logger';
import policyStore from '../services/policyStore';
import explainService from '../services/explainService';
import simulator from '../services/simulator';
import { Policy } from '../models/policy';

const router = Router();

export interface PolicyPostResult extends RouteResult {
  body: {
    policy?: Policy;
    simulation?: any;
    simulationError?: string;
    error?: string;
  };
}

export interface RouteResult<T = any> {
  status: number;
  body: T;
}

export async function handlePolicyPost(body: any, principalId = 'unknown'): Promise<PolicyPostResult> {
  const name = body.name;
  const severity = body.severity;
  const rule = body.rule;
  const metadata = body.metadata ?? {};
  const metadataProvided = Object.prototype.hasOwnProperty.call(body, 'metadata');
  const simulate = Boolean(body.simulate);
  const simulationOptions = {
    sampleSize: typeof body.sampleSize === 'number' ? body.sampleSize : undefined,
    sampleEvents: Array.isArray(body.sampleEvents) ? body.sampleEvents : undefined,
  };
  const versionFromId: string | null = body.versionFromId || body.previousId || body.baseId || null;

  try {
    let policy: Policy;
    if (versionFromId) {
      const updates: Partial<Policy> = {};
      if (rule) updates.rule = rule;
      if (metadataProvided) updates.metadata = metadata;
      if (severity) updates.severity = severity;
      if (body.state) updates.state = body.state;

      if (!updates.rule && !updates.metadata && !updates.severity && !updates.state) {
        return { status: 400, body: { error: 'provide at least one field to update for new version' } };
      }

      policy = await policyStore.createPolicyNewVersion(versionFromId, updates, principalId);
    } else {
      if (!name || !severity || !rule) {
        return { status: 400, body: { error: 'name, severity, and rule are required' } };
      }
      policy = await policyStore.createPolicy({
        name,
        severity,
        rule,
        metadata,
        createdBy: principalId,
      });
    }

    let responsePolicy = policy;

    if (simulate) {
      try {
        responsePolicy = await policyStore.setPolicyState(policy.id, 'simulating', principalId);
      } catch (stateErr) {
        logger.warn('failed to set policy state to simulating', stateErr);
      }
      try {
        const report = await simulator.runSimulation(policy.id, {
          sampleSize: simulationOptions.sampleSize,
          sampleEvents: simulationOptions.sampleEvents,
        });
        return { status: 201, body: { policy: responsePolicy, simulation: report } };
      } catch (simErr) {
        logger.warn('policy created but simulation failed', simErr);
        return { status: 201, body: { policy: responsePolicy, simulationError: String(simErr) } };
      }
    }

    return { status: 201, body: { policy: responsePolicy } };
  } catch (err: any) {
    logger.error('failed to create policy', err);
    return { status: 500, body: { error: err?.message || 'internal_server_error' } };
  }
}

/**
 * POST /
 * Create or update a policy.
 */
router.post('/', async (req: Request, res: Response) => {
  const createdBy = (req as any).principal?.id ?? 'unknown';
  const result = await handlePolicyPost(req.body ?? {}, createdBy);
  return res.status(result.status).json(result.body);
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

/**
 * GET /:id
 * Return raw policy row (latest version when multiple matches). For now this fetches by id only.
 */
router.get('/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'policy id required' });
  try {
    const policy = await policyStore.getPolicyById(id);
    if (!policy) return res.status(404).json({ error: 'policy_not_found' });
    return res.json({ policy });
  } catch (err: any) {
    logger.error('failed to fetch policy', err);
    return res.status(500).json({ error: err?.message || 'internal_server_error' });
  }
});

export default router;
