import memoryRoutes from '../routes/memoryRoutes';
import type { MemoryNodeView, MemoryServiceDeps } from '../types';
import type { Router, Request, Response, NextFunction } from 'express';

type Principal = { id: string; roles: string[] };

const buildServiceMock = (): any => ({
  createMemoryNode: jest.fn(),
  getMemoryNode: jest.fn(),
  getArtifact: jest.fn(),
  createArtifact: jest.fn(),
  searchMemoryNodes: jest.fn(),
  setLegalHold: jest.fn(),
  deleteMemoryNode: jest.fn()
});

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

const getRouteHandlers = (router: Router, method: string, path: string): Handler[] => {
  const stack: any[] = (router as any).stack || [];
  const layer = stack.find((entry) => entry.route && entry.route.path === path && entry.route.methods?.[method.toLowerCase()]);
  if (!layer?.route) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }
  return layer.route.stack.map((entry: any) => entry.handle);
};

const runHandlers = async (handlers: Handler[], req: Request, res: Response & { finished: boolean }): Promise<void> => {
  for (const handler of handlers) {
    let nextCalled = false;
    await new Promise<void>((resolve, reject) => {
      const next: NextFunction = (err?: unknown) => {
        nextCalled = true;
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };
      try {
        const result = handler(req, res, next);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).then(
            () => {
              if (!nextCalled) resolve();
            },
            reject
          );
        } else if (!nextCalled) {
          resolve();
        }
      } catch (error) {
        reject(error);
      }
    });
    if (!nextCalled && res.finished) {
      break;
    }
  }
};

const createMockRequest = (overrides?: Partial<Request>): Request => {
  const headers: Record<string, string> = {};
  const base: Partial<Request> = {
    method: 'GET',
    path: '/v1/memory/nodes/node-123',
    params: { id: 'node-123' },
    headers,
    header(name: string) {
      return headers[String(name).toLowerCase()];
    }
  };
  Object.assign(headers, (overrides?.headers as Record<string, string>) ?? {});
  return Object.assign(base, overrides) as Request;
};

const createMockResponse = (): Response & { body?: any; statusCode: number; finished: boolean } => {
  const res: Partial<Response> & { headers: Record<string, string>; statusCode: number; body?: any; finished: boolean } = {
    headers: {},
    statusCode: 200,
    finished: false,
    locals: {},
    setHeader(name: string, value: string) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      this.finished = true;
      return this;
    }
  };
  return res as Response & { body?: any; statusCode: number; finished: boolean };
};

const invokeNodeRoute = async (handlers: Handler[], principal: Principal | undefined) => {
  const overrides: Partial<Request> = principal
    ? ({
        principal: {
          id: principal.id,
          roles: principal.roles,
          type: 'service',
          source: 'dev'
        }
      } as any)
    : {};
  const req = createMockRequest(overrides);
  const res = createMockResponse();
  await runHandlers(handlers, req, res);
  return res;
};

describe('memoryRoutes auth + pii redaction', () => {
  let service: any;
  let nodeFixture: MemoryNodeView;
  let handlers: Handler[];

  beforeEach(() => {
    service = buildServiceMock();
    nodeFixture = {
      memoryNodeId: 'node-123',
      owner: 'owner-1',
      embeddingId: 'vector-1',
      metadata: { topic: 'mission' },
      piiFlags: { containsEmail: true },
      legalHold: false,
      ttlSeconds: null,
      expiresAt: null,
      artifacts: []
    };
    service.getMemoryNode.mockResolvedValue(nodeFixture);

    const router = memoryRoutes(service);
    handlers = getRouteHandlers(router, 'get', '/memory/nodes/:id');
  });

  it('rejects callers lacking read scope', async () => {
    const response = await invokeNodeRoute(handlers, { id: 'svc-a', roles: ['memory:write'] });

    expect(response.statusCode).toBe(403);
    expect(service.getMemoryNode).not.toHaveBeenCalled();
  });

  it('redacts piiFlags for callers without read:pii scope', async () => {
    const response = await invokeNodeRoute(handlers, { id: 'svc-b', roles: ['memory:read'] });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBeDefined();
    expect(response.body.piiFlags).toEqual({});
    expect(nodeFixture.piiFlags).toEqual({ containsEmail: true });
  });

  it('returns piiFlags when caller has read:pii', async () => {
    const response = await invokeNodeRoute(handlers, { id: 'svc-c', roles: ['memory:read', 'read:pii'] });

    expect(response.statusCode).toBe(200);
    expect(response.body.piiFlags).toEqual({ containsEmail: true });
  });
});
