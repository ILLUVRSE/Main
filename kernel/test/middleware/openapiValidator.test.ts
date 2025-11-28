import request from '../utils/mockSupertest';
import { getExpressAppForTests } from '../utils/testApp';

let appForTests: any;

beforeAll(async () => {
  appForTests = await getExpressAppForTests();
});

describe('OpenAPI validation middleware', () => {
  test('rejects invalid division manifest payloads', async () => {
    const res = await request(appForTests)
      .post('/kernel/division')
      .set('Accept', 'application/json')
      .send({ name: 12345 /* invalid type */ });
    expect([400, 422]).toContain(res.status);
    expect(res.body).toBeDefined();
  });
});
