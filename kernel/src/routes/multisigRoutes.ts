/**
 * kernel/src/routes/multisigRoutes.ts
 */

import express, { Request, Response, Router } from 'express';
import { multisigService } from '../services/multisig';
import { requireAnyAuthenticated } from '../rbac';
import { authMiddleware } from '../middleware/auth';
import { getPrincipalFromRequest } from '../rbac';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function requireAuth(): any[] {
  if (!IS_PRODUCTION) return [];
  return [authMiddleware, requireAnyAuthenticated];
}

export default function createMultisigRouter(): Router {
  const router = express.Router();

  // POST /kernel/multisig/propose
  router.post('/propose', ...requireAuth(), async (req: Request, res: Response, next) => {
    try {
      const { proposal_id, payload, signer_set, required_threshold } = req.body;
      const principal = (req as any).principal || getPrincipalFromRequest(req);
      const proposerId = principal?.id || 'unknown';

      if (!proposal_id || !payload || !signer_set) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const proposal = await multisigService.createProposal(
        proposal_id,
        proposerId,
        payload,
        signer_set,
        required_threshold
      );
      return res.status(201).json(proposal);
    } catch (err) {
      return next(err);
    }
  });

  // POST /kernel/multisig/:id/approve
  router.post('/:id/approve', ...requireAuth(), async (req: Request, res: Response, next) => {
    try {
      const { id } = req.params;
      const { signature } = req.body;
      const principal = (req as any).principal || getPrincipalFromRequest(req);

      const signerId = principal?.id;

      if (!signerId || !signature) {
          return res.status(400).json({ error: 'Missing signer identity or signature' });
      }

      const approval = await multisigService.approveProposal(id, signerId, signature);
      return res.json(approval);
    } catch (err) {
      return next(err);
    }
  });

  // POST /kernel/multisig/:id/revoke
  router.post('/:id/revoke', ...requireAuth(), async (req: Request, res: Response, next) => {
    try {
      const { id } = req.params;
      const principal = (req as any).principal || getPrincipalFromRequest(req);
      const signerId = principal?.id;

      if (!signerId) return res.status(401).json({ error: 'Unauthenticated' });

      await multisigService.revokeApproval(id, signerId);
      return res.json({ status: 'revoked' });
    } catch (err) {
      return next(err);
    }
  });

  // POST /kernel/multisig/:id/apply
  router.post('/:id/apply', ...requireAuth(), async (req: Request, res: Response, next) => {
    try {
      const { id } = req.params;
      const principal = (req as any).principal || getPrincipalFromRequest(req);
      const applierId = principal?.id || 'unknown';

      await multisigService.applyProposal(id, applierId);
      return res.json({ status: 'applied' });
    } catch (err) {
      return next(err);
    }
  });

  // POST /kernel/multisig/:id/ratify
  router.post('/:id/ratify', ...requireAuth(), async (req: Request, res: Response, next) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const principal = (req as any).principal || getPrincipalFromRequest(req);

      await multisigService.ratifyProposal(id, principal?.id || 'unknown', reason);
      return res.json({ status: 'ratified' });
    } catch (err) {
      return next(err);
    }
  });

  // GET /kernel/multisig/:id
  router.get('/:id', ...requireAuth(), async (req: Request, res: Response, next) => {
    try {
      const { id } = req.params;
      const proposal = await multisigService.getProposal(id);
      if (!proposal) return res.status(404).json({ error: 'Not found' });
      return res.json(proposal);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
