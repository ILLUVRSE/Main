import path from 'path';
import fs from 'fs/promises';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import mockRequest from '../../../kernel/test/utils/mockSupertest';
import {
  __setChatImplementationForTests,
  __setGenerateImplementationForTests
} from '../src/utils/ollama';
import ideaRouter, { __resetIdeaCacheForTests } from '../src/routes/idea';
import chatRouter from '../src/routes/chat';
import gitRouter from '../src/routes/git';

jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));
jest.mock('jose', () => ({
  jwtVerify: jest.fn(async () => ({ payload: { sub: 'tester', roles: ['Operator'] } })),
  createRemoteJWKSet: () => jest.fn()
}));
jest.mock('simple-git', () => {
  const status = jest.fn(async () => ({ current: 'main', ahead: 0, behind: 0 }));
  const diff = jest.fn(async () => 'mock-diff');
  const add = jest.fn(async () => ({}));
  const commit = jest.fn(async () => ({ commit: 'abc123', summary: {} }));
  const push = jest.fn(async () => ({ pushed: true }));
  return () => ({ status, diff, add, commit, push });
});

let app: any;
process.env.NODE_ENV = 'test';

const ideasPath = path.resolve(process.cwd(), 'data/ideas.json');
const ideasLockPath = `${ideasPath}.lock`;

beforeAll(async () => {
  app = express();
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use((req, _res, next) => {
    if ((req as any)._mockJsonBody !== undefined) {
      req.body = (req as any)._mockJsonBody;
      try {
        (req as any).rawBody = Buffer.from(JSON.stringify(req.body));
      } catch {
        (req as any).rawBody = null;
      }
      (req as any)._body = true;
    }
    next();
  });
  app.use('/chat', chatRouter);
  app.use('/api/v1', ideaRouter);
  app.use('/git', gitRouter);
});

beforeEach(async () => {
  __setChatImplementationForTests(async () => 'mocked chat response');
  __setGenerateImplementationForTests(async () => 'mocked generation response');
  await fs.mkdir(path.dirname(ideasPath), { recursive: true });
  await fs.rm(ideasPath, { force: true });
  await fs.writeFile(ideasPath, JSON.stringify({ ideas: [] }), 'utf8');
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
    const res = await mockRequest(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST /chat returns mocked text', async () => {
    const res = await mockRequest(app)
      .post('/chat')
      .send({ messages: [{ role: 'user', content: 'Hello there' }] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.text).toBe('mocked chat response');
  });

  it('Idea lifecycle create/list/get/generate', async () => {
    const createRes = await mockRequest(app)
      .post('/api/v1/idea')
      .send({ title: 'Test Idea', description: 'Explore a new gameplay mechanic.' });
    expect(createRes.status).toBe(201);
    const ideaId = createRes.body.idea.id;

    const listRes = await mockRequest(app).get('/api/v1/idea');
    expect(listRes.status).toBe(200);
    expect(listRes.body.ok).toBe(true);
    expect(listRes.body.ideas).toHaveLength(1);

    const getRes = await mockRequest(app).get(`/api/v1/idea/${ideaId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.idea.history).toEqual([]);

    __setChatImplementationForTests(async () => 'Roadmap generated.');

    const generateRes = await mockRequest(app).post(`/api/v1/idea/${ideaId}/generate`).send({});
    expect(generateRes.status).toBe(200);
    expect(generateRes.body.ok).toBe(true);
    expect(generateRes.body.generation.text).toBe('Roadmap generated.');

    const finalGet = await mockRequest(app).get(`/api/v1/idea/${ideaId}`);
    expect(finalGet.status).toBe(200);
    expect(finalGet.body.idea.history).toHaveLength(1);
  });

  it('GET /git/status returns mocked status', async () => {
    const res = await mockRequest(app).get('/git/status');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.status).toBe('object');
  });
});
