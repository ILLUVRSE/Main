import express, { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import agentProxy from '../../lib/agentProxy';
import signerRegistry from '../../lib/signerRegistry';
import auditWriter from '../../lib/auditWriter';
import logger from '../../lib/logger';
import { requireAdmin } from '../../middleware/adminAuth';

const router = express.Router();

// All admin agent routes require admin auth
router.use(requireAdmin);

/**
 * List all registered agents
 * GET /admin/agents
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const agents = await agentProxy.listAgents();
    res.json({ ok: true, agents });
  } catch (err) {
    logger.error('Failed to list agents', { err });
    next(err);
  }
});

/**
 * Create a new agent
 * POST /admin/agents
 * body: { name: string, config?: object, signerId?: string }
 *
 * If signerId is provided we attempt to attach a signer from signerRegistry.
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, config = {}, signerId } = req.body ?? {};

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }

    // If a signer id was given, validate it
    if (signerId) {
      const signer = await signerRegistry.getSignerById(signerId);
      if (!signer) {
        return res.status(404).json({ ok: false, error: `signer ${signerId} not found` });
      }
    }

    const id = uuidv4();
    const created = await agentProxy.createAgent({
      id,
      name,
      config,
      signerId: signerId ?? null,
      createdBy: (req as any).user?.id ?? 'admin',
    });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.agent.create',
      details: { agentId: id, name, signerId: signerId ?? null },
    });

    res.status(201).json({ ok: true, agent: created });
  } catch (err) {
    logger.error('Failed to create agent', { err });
    next(err);
  }
});

/**
 * Get a single agent by id
 * GET /admin/agents/:id
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const agent = await agentProxy.getAgent(id);
    if (!agent) return res.status(404).json({ ok: false, error: 'agent not found' });
    res.json({ ok: true, agent });
  } catch (err) {
    logger.error('Failed to fetch agent', { err });
    next(err);
  }
});

/**
 * Update agent metadata (name/config)
 * PATCH /admin/agents/:id
 * body: { name?: string, config?: object, signerId?: string | null }
 */
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, config, signerId } = req.body ?? {};

    // If signerId explicitly provided (including null), validate it
    if (typeof signerId === 'string') {
      const signer = await signerRegistry.getSignerById(signerId);
      if (!signer) {
        return res.status(404).json({ ok: false, error: `signer ${signerId} not found` });
      }
    }

    const updated = await agentProxy.updateAgent(id, { name, config, signerId });
    if (!updated) return res.status(404).json({ ok: false, error: 'agent not found' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.agent.update',
      details: { agentId: id, changes: { name, signerId } },
    });

    res.json({ ok: true, agent: updated });
  } catch (err) {
    logger.error('Failed to update agent', { err });
    next(err);
  }
});

/**
 * Revoke (delete) an agent
 * DELETE /admin/agents/:id
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const removed = await agentProxy.revokeAgent(id);

    if (!removed) return res.status(404).json({ ok: false, error: 'agent not found' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.agent.revoke',
      details: { agentId: id },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error('Failed to revoke agent', { err });
    next(err);
  }
});

/**
 * Rotate an agent's credentials / keys
 * POST /admin/agents/:id/rotate
 */
router.post('/:id/rotate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const rotated = await agentProxy.rotateAgentKeys(id);
    if (!rotated) return res.status(404).json({ ok: false, error: 'agent not found' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.agent.rotate',
      details: { agentId: id },
    });

    res.json({ ok: true, keys: rotated });
  } catch (err) {
    logger.error('Failed to rotate agent keys', { err });
    next(err);
  }
});

/**
 * Redeploy agent configuration (trigger remote agent).
 * POST /admin/agents/:id/redeploy
 */
router.post('/:id/redeploy', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await agentProxy.redeployAgent(id);
    if (!result) return res.status(404).json({ ok: false, error: 'agent not found or redeploy failed' });

    await auditWriter.write({
      actor: (req as any).user?.id ?? 'admin',
      action: 'admin.agent.redeploy',
      details: { agentId: id },
    });

    res.json({ ok: true, result });
  } catch (err) {
    logger.error('Failed to redeploy agent', { err });
    next(err);
  }
});

export default router;

