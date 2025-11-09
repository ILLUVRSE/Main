import request from 'supertest';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  __setChatImplementationForTests,
  __setGenerateImplementationForTests
} from '../src/utils/ollama.js';
import { __resetIdeaCacheForTests } from '../src/routes/idea.ts';

let app: any;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ideasPath = path.resolve(__dirname, '../data/ideas.json');
const ideasLockPath = `${ideasPath}.lock`;

beforeAll(async () => {
  ({ default: app } = await import('../src/index.js'));
});

beforeEach(async () => {
  __setChatImplementationForTests(async () => 'mocked chat response');
  __setGenerateImplementationForTests(async () => 'mocked generation response');
  await fs.rm(ideasPath, { force: true });
  await fs.rm(ideasLockPath, { force: true });
  __resetIdeaCacheForTests();
});

afterAll(async () => {
  __setChatImplementationForTests(null);
  __setGenerateImplementationForTests(null);
  await fs.rm(ideasPath, { force: true });
  await fs.rm(ideasLockPath, { force: true });
});

describe('IDEA API routes', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST /chat returns mocked text', async () => {
    const res = await request(app)
      .post('/chat')
      .send({ messages: [{ role: 'user', content: 'Hello there' }] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.text).toBe('mocked chat response');
  });

  it('Idea lifecycle create/list/get/generate', async () => {
    const createRes = await request(app)
      .post('/api/v1/idea')
      .send({ title: 'Test Idea', description: 'Explore a new gameplay mechanic.' });
    expect(createRes.status).toBe(201);
    const ideaId = createRes.body.idea.id;

    const listRes = await request(app).get('/api/v1/idea');
    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(listRes.body.ideas).toHaveLength(1);

    const getRes = await request(app).get(`/api/v1/idea/${ideaId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.idea.history).toEqual([]);

    __setChatImplementationForTests(async () => 'Roadmap generated.');

    const generateRes = await request(app).post(`/api/v1/idea/${ideaId}/generate`).send({});
    expect(generateRes.status).toBe(200);
    expect(generateRes.body.ok).toBe(true);
    expect(generateRes.body.generation.text).toBe('Roadmap generated.');

    const finalGet = await request(app).get(`/api/v1/idea/${ideaId}`);
    expect(finalGet.status).toBe(200);
    expect(finalGet.body.idea.history).toHaveLength(1);
  });

  it('GET /git/status returns mocked status', async () => {
    const res = await request(app).get('/git/status');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.status).toBe('object');
  });
});
