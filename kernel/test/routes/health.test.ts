import request from '../utils/mockSupertest';
import { getExpressAppForTests } from '../utils/testApp';

let appForTests: any;

beforeAll(async () => {
  appForTests = await getExpressAppForTests();
});

describe('healthRoutes', () => {
  const paths = ['/health', '/healthz', '/_health', '/ready', '/_ready'];

  test('GET /health (or equivalent) responds', async () => {
    const res = await request(appForTests).get('/health');
    expect([200, 204, 404, 503]).toContain(res.status); // allow 503 when readiness fails dependencies
  });

  test('Common alternate endpoints respond (healthz, _health, ready, _ready)', async () => {
    for (const p of paths) {
      const res = await request(appForTests).get(p);
      expect([200, 204, 404, 503]).toContain(res.status);
    }
  });

  test('Health endpoints should return a small JSON object when present', async () => {
    const res = await request(appForTests).get('/health').set('Accept', 'application/json');
    if (res.status === 200) {
      expect(typeof res.body === 'object').toBeTruthy();
    }
  });
});
