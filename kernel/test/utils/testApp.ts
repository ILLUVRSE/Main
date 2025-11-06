// kernel/test/utils/testApp.ts
import express, { Request, Response } from 'express';
import { authMiddleware } from '../../src/auth/middleware';
import {
  getPrincipalFromRequest,
  requireRoles,
  requireAnyAuthenticated,
  Roles,
} from '../../src/rbac';
import { setSentinelClient, resetSentinelClient } from '../../src/sentinelClient';

export type TestAppOpts = {
  mockSentinel?: any;      // optional test double for sentinel (must implement record, etc.)
  kmsEndpoint?: string;    // optional KMS endpoint override for tests
};

/**
 * createTestApp
 *
 * Returns an Express app with:
 * - global authMiddleware (attempts OIDC JWT verification and mTLS cert extraction)
 * - /principal -> returns the principal attached or computed
 * - /require-any -> guarded by requireAnyAuthenticated
 * - /require-roles -> guarded by requireRoles(SuperAdmin, Operator)
 *
 * Optionally accepts test helpers (mockSentinel, kmsEndpoint).
 *
 * For convenience the returned app may have a `.teardown()` method attached which
 * tests should call to reset injected mocks (e.g., sentinel).
 */
export function createTestApp(opts?: TestAppOpts) {
  const app = express();

  // allow tests to inject a mock sentinel client
  if (opts?.mockSentinel) {
    try {
      setSentinelClient(opts.mockSentinel);
    } catch (e) {
      // ignore: tests may not require sentinel
      // eslint-disable-next-line no-console
      console.warn('createTestApp: setSentinelClient failed:', (e as Error).message || e);
    }
  }

  // allow tests to override KMS endpoint via opts
  const originalKms = process.env.KMS_ENDPOINT;
  if (opts?.kmsEndpoint) {
    process.env.KMS_ENDPOINT = opts.kmsEndpoint;
  }

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

  // Attach a teardown helper for tests to clean up injected mocks / env changes
  (app as any).teardown = () => {
    try {
      resetSentinelClient();
    } catch (e) {
      // noop
    }
    if (opts?.kmsEndpoint) {
      if (typeof originalKms === 'undefined') {
        delete process.env.KMS_ENDPOINT;
      } else {
        process.env.KMS_ENDPOINT = originalKms;
      }
    }
  };

  return app;
}

export default createTestApp;

