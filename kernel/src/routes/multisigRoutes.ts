import express, { Request, Response, NextFunction } from 'express';
import { multisigService } from '../services/multisig';
import { requireAuthInProduction, requireRolesInProduction, Roles, getPrincipalFromRequest } from '../rbac';

export default function createMultisigRouter() {
  const router = express.Router();

  // POST /multisig/signer - Register a signer (Admin only)
  router.post(
    '/signer',
    ...requireRolesInProduction(Roles.SUPERADMIN),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { id, publicKey, role } = req.body;
        if (!id || !publicKey) {
          return res.status(400).json({ error: 'id and publicKey are required' });
        }
        const signer = await multisigService.registerSigner(id, publicKey, role);
        return res.status(201).json(signer);
      } catch (err) {
        return next(err);
      }
    }
  );

  // POST /multisig/proposals - Create a proposal
  router.post(
    '/proposals',
    ...requireAuthInProduction(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { title, description, payload, expiresAt } = req.body;
        const principal = getPrincipalFromRequest(req);
        const createdBy = principal?.id || 'unknown';

        if (!title || !payload) {
          return res.status(400).json({ error: 'title and payload are required' });
        }

        const proposal = await multisigService.createProposal(
            title, description, payload, createdBy, expiresAt ? new Date(expiresAt) : undefined
        );
        return res.status(201).json(proposal);
      } catch (err) {
        return next(err);
      }
    }
  );

  // GET /multisig/proposals/:id - Get a proposal
  router.get(
      '/proposals/:id',
      ...requireAuthInProduction(),
      async (req: Request, res: Response, next: NextFunction) => {
          try {
              const proposal = await multisigService.getProposal(req.params.id);
              return res.json(proposal);
          } catch (err) {
              if ((err as Error).message === 'Proposal not found') {
                  return res.status(404).json({ error: 'not found' });
              }
              return next(err);
          }
      }
  );

  // POST /multisig/proposals/:id/approve - Approve a proposal
  router.post(
      '/proposals/:id/approve',
      ...requireAuthInProduction(),
      async (req: Request, res: Response, next: NextFunction) => {
          try {
              const { signerId, signature } = req.body;
              if (!signerId || !signature) {
                  return res.status(400).json({ error: 'signerId and signature are required' });
              }
              const proposal = await multisigService.approveProposal(req.params.id, signerId, signature);
              return res.json(proposal);
          } catch (err) {
               if ((err as Error).message === 'Proposal not found') {
                  return res.status(404).json({ error: 'not found' });
              }
              return next(err);
          }
      }
  );

  // POST /multisig/proposals/:id/execute - Execute a proposal
  router.post(
      '/proposals/:id/execute',
      ...requireAuthInProduction(),
      async (req: Request, res: Response, next: NextFunction) => {
          try {
              await multisigService.executeProposal(req.params.id);
              return res.json({ status: 'executed' });
          } catch (err) {
              return next(err);
          }
      }
  );

  // POST /multisig/proposals/:id/ratify - Emergency ratify
  router.post(
      '/proposals/:id/ratify',
      ...requireRolesInProduction(Roles.SUPERADMIN),
      async (req: Request, res: Response, next: NextFunction) => {
          try {
              const principal = getPrincipalFromRequest(req);
              const ratifierId = principal?.id || 'unknown';
              const proposal = await multisigService.ratifyProposal(req.params.id, ratifierId);
              return res.json(proposal);
          } catch (err) {
              return next(err);
          }
      }
  );

  return router;
}
