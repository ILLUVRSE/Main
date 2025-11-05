// kernel/test/utils/testApp.ts
import express, { Request, Response } from 'express';
import { authMiddleware } from '../../src/auth/middleware';
import {
  getPrincipalFromRequest,
  requireRoles,
  requireAnyAuthenticated,
  Roles,
} from '../../src/rbac';

/**
 * createTestApp
 *
 * Returns an Express app with:
 * - global authMiddleware (attempts OIDC JWT verification and mTLS cert extraction)
 * - /principal -> returns the principal attached or computed
 * - /require-any -> guarded by requireAnyAuthenticated
 * - /require-roles -> guarded by requireRoles(SuperAdmin, Operator)
 *
 * Tests should call createTestApp() and use supertest to exercise these endpoints.
 */
export function createTestApp() {
  const app = express();

  // Parse JSON (some tests may POST)
  app.use(express.json());

  // Install auth middleware globally so it attempts JWT / mTLS extraction.
  app.use((req: Request, res: Response, next) => {
    // authMiddleware is async; call and forward errors to next()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    Promise.resolve(authMiddleware(req as any, res as any, next)).catch(next);
  });

  // Returns the computed/attached principal (does not enforce auth)
  app.get('/principal', (req: Request, res: Response) => {
    const principal = req.principal ?? getPrincipalFromRequest(req);
    // ensure it's attached for downstream assertions
    (req as any).principal = principal;
    return res.json({ principal });
  });

  // Require any authenticated principal (human or service)
  app.get('/require-any', requireAnyAuthenticated, (req: Request, res: Response) => {
    return res.json({ ok: true, principal: req.principal });
  });

  // Require at least one of the roles (SuperAdmin OR Operator) for access
  app.get(
    '/require-roles',
    requireRoles(Roles.SUPERADMIN, Roles.OPERATOR),
    (req: Request, res: Response) => {
      return res.json({ ok: true, principal: req.principal });
    }
  );

  return app;
}

export default createTestApp;

