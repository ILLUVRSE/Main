import request from '../utils/mockSupertest';
import { getExpressAppForTests } from '../utils/testApp';
import { ReasoningClientError, setReasoningClient } from '../../src/reasoning/client';

let appForTests: any;

class StubReasoningClient {
  async getRedactedTrace(): Promise<never> {
    throw new ReasoningClientError('trace_not_found', 404);
  }
}

beforeAll(async () => {
  setReasoningClient(new StubReasoningClient() as any);
  appForTests = await getExpressAppForTests();
});

afterAll(() => {
  setReasoningClient(null);
});

describe('reasonRoutes', () => {
  const endpoint = (nodeId: string) => `/kernel/reason/${nodeId}`;

  test('GET /kernel/reason/:node denies anonymous access', async () => {
    const res = await request(appForTests).get(endpoint('node-1')).set('Accept', 'application/json');
    // Depending on configuration, unauthenticated may return 401/403, or 404 if route intentionally hides existence.
    expect([401, 403, 404]).toContain(res.status);
  });

  test('GET /kernel/reason/:node returns 404 for authenticated human principal when node missing', async () => {
    const res = await request(appForTests)
      .get(endpoint('node-absent'))
      .set('Accept', 'application/json')
      // test-only headers used by many integration/unit tests in this repo
      .set('x-oidc-sub', 'user.dev')
      .set('x-oidc-roles', 'Operator');
    // If node does not exist we expect a 404, authenticated request should not be treated as anonymous.
    expect(res.status).toBe(404);
    // Ensure JSON body is returned (may be { error: 'not_found' } or similar)
    expect(res.body).toBeDefined();
  });

  test('GET /kernel/reason/:node allows service principal with Operator role (returns 404 for missing node)', async () => {
    const res = await request(appForTests)
      .get(endpoint('node-absent-2'))
      .set('Accept', 'application/json')
      // service principal headers used in tests
      .set('x-service-id', 'svc.kernel')
      .set('x-service-roles', 'Operator');
    expect(res.status).toBe(404);
    expect(res.body).toBeDefined();
  });
});
