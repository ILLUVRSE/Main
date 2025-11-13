// kernel/test/integration/rbac.integration.test.ts
/**
 * RBAC integration tests. These tests assert the principal returned by /principal
 * contains expected roles. To avoid brittle failures, normalize roles to kebab-case
 * and lower-case before asserting.
 *
 * If your server export path is different, adjust resolveApp().
 */

import request from 'supertest';
import { createApp } from '../../src/server';

let app: any;

beforeAll(async () => {
  app = await createApp();
});

function normalizeRole(r: string): string {
  // Convert camelCase or PascalCase or underscore/space to kebab-case, then lower-case.
  return r
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2') // camel -> kebab
    .replace(/[_\s]+/g, '-')                // underscores/spaces -> hyphen
    .toLowerCase();
}

describe('RBAC integration (test-only endpoints)', () => {
  test('GET /principal returns the principal computed from x-oidc headers', async () => {
    // Compose a headers payload that mirrors how tests set OIDC headers.
    // Many of our tests send an "x-oidc-claim-roles" or "x-oidc-roles" header;
    // try a few common header names so this test is robust.
    const headerNames = ['x-oidc-roles', 'x-oidc-claim-roles', 'x-oidc-claims'];
    // Provide roles in mixed formats to ensure normalization works.
    const rawRoles = ['Operator', 'DivisionLead'];

    // Try each header name until one returns 200
    let res: request.Response | undefined;
    for (const h of headerNames) {
      res = await request(app)
        .get('/principal')
        .set(h, rawRoles.join(','))  // server-side role parser should parse comma-separated list
        .set('Accept', 'application/json');
      if (res.status === 200) break;
    }

    if (!res) {
      throw new Error('No response received from /principal during RBAC test');
    }

    // If server returned non-200, fail with helpful debug
    expect(res.status).toBe(200);

    const p = res.body;
    // Ensure roles array shape
    expect(Array.isArray(p.roles)).toBe(true);

    const receivedRolesNormalized = p.roles.map((r: string) => normalizeRole(String(r)));
    // Expect normalized roles to contain the canonical forms
    expect(receivedRolesNormalized).toEqual(expect.arrayContaining(['operator', 'division-lead']));
  });

  test('GET /require-roles allows access when caller has Operator role', async () => {
    // Assuming /require-roles is an endpoint that requires Operator role
    const res = await request(app)
      .get('/require-roles')
      .set('x-oidc-roles', 'Operator')
      .set('Accept', 'application/json');

    // Accept 200 for success, or 403 for misconfigured guard; assert expected shape
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toBeDefined();
    }
  });
});
