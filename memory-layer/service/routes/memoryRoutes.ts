import { Router, Request, Response, NextFunction } from 'express';
import type { MemoryService, MemoryNodeInput, SearchRequest, ArtifactInput } from '../types';
import { requireScopes, MemoryScopes } from '../middleware/auth';
import { piiRedactionMiddleware } from '../middleware/piiRedaction';

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

const buildAuditContext = (req: Request) => ({
  manifestSignatureId: req.header('x-manifest-signature-id') ?? undefined,
  prevAuditHash: req.header('x-prev-audit-hash') ?? undefined,
  caller: req.header('x-service-id') ?? 'unknown'
});

export const memoryRoutes = (memoryService: MemoryService): Router => {
  const router = Router();

  router.post(
    '/memory/nodes',
    requireScopes(MemoryScopes.WRITE),
    asyncHandler(async (req, res) => {
      const payload = req.body as MemoryNodeInput;
      const result = await memoryService.createMemoryNode(payload, buildAuditContext(req));
      res.status(201).json(result);
    })
  );

  router.get(
    '/memory/nodes/:id',
    requireScopes(MemoryScopes.READ),
    piiRedactionMiddleware,
    asyncHandler(async (req, res) => {
      const node = await memoryService.getMemoryNode(req.params.id);
      if (!node) {
        res.status(404).json({ error: { message: 'memory node not found' } });
        return;
      }
      res.json(node);
    })
  );

  router.post(
    '/memory/artifacts',
    requireScopes(MemoryScopes.WRITE),
    asyncHandler(async (req, res) => {
      const payload = req.body as ArtifactInput & { memoryNodeId?: string | null };
      const result = await memoryService.createArtifact(payload.memoryNodeId ?? null, payload, buildAuditContext(req));
      res.status(201).json(result);
    })
  );

  router.post(
    '/memory/search',
    requireScopes(MemoryScopes.READ),
    asyncHandler(async (req, res) => {
      const payload = req.body as SearchRequest;
      const results = await memoryService.searchMemoryNodes(payload);
      res.json({ results });
    })
  );

  router.post(
    '/memory/nodes/:id/legal-hold',
    requireScopes({ anyOf: [MemoryScopes.LEGAL_HOLD, MemoryScopes.ADMIN] }),
    asyncHandler(async (req, res) => {
      const { legalHold, reason } = req.body as { legalHold: boolean; reason?: string };
      if (typeof legalHold !== 'boolean') {
        res.status(400).json({ error: { message: 'legalHold boolean is required' } });
        return;
      }
      await memoryService.setLegalHold(req.params.id, legalHold, reason, buildAuditContext(req));
      res.status(204).send();
    })
  );

  router.delete(
    '/memory/nodes/:id',
    requireScopes({ anyOf: [MemoryScopes.ADMIN, MemoryScopes.WRITE] }),
    asyncHandler(async (req, res) => {
      const ctx = buildAuditContext(req);
      await memoryService.deleteMemoryNode(req.params.id, ctx.caller ?? 'unknown', ctx);
      res.status(204).send();
    })
  );

  router.get(
    '/memory/artifacts/:id',
    requireScopes(MemoryScopes.READ),
    asyncHandler(async (req, res) => {
      const artifact = await memoryService.getArtifact(req.params.id);
      if (!artifact) {
        res.status(404).json({ error: { message: 'artifact not found' } });
        return;
      }
      res.json(artifact);
    })
  );

  return router;
};

export default memoryRoutes;
