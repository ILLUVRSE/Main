"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const memoryRoutes_1 = __importDefault(require("../routes/memoryRoutes"));
const buildServiceMock = () => ({
    createMemoryNode: jest.fn(),
    getMemoryNode: jest.fn(),
    getArtifact: jest.fn(),
    createArtifact: jest.fn(),
    searchMemoryNodes: jest.fn(),
    setLegalHold: jest.fn(),
    deleteMemoryNode: jest.fn()
});
const getRouteHandlers = (router, method, path) => {
    const stack = router.stack || [];
    const layer = stack.find((entry) => entry.route && entry.route.path === path && entry.route.methods?.[method.toLowerCase()]);
    if (!layer?.route) {
        throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
    }
    return layer.route.stack.map((entry) => entry.handle);
};
const runHandlers = async (handlers, req, res) => {
    for (const handler of handlers) {
        let nextCalled = false;
        await new Promise((resolve, reject) => {
            const next = (err) => {
                nextCalled = true;
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            };
            try {
                const result = handler(req, res, next);
                if (result && typeof result.then === 'function') {
                    result.then(() => {
                        if (!nextCalled)
                            resolve();
                    }, reject);
                }
                else if (!nextCalled) {
                    resolve();
                }
            }
            catch (error) {
                reject(error);
            }
        });
        if (!nextCalled && res.finished) {
            break;
        }
    }
};
const createMockRequest = (overrides) => {
    const headers = {};
    const base = {
        method: 'GET',
        path: '/v1/memory/nodes/node-123',
        params: { id: 'node-123' },
        headers,
        header(name) {
            return headers[String(name).toLowerCase()];
        }
    };
    Object.assign(headers, overrides?.headers ?? {});
    return Object.assign(base, overrides);
};
const createMockResponse = () => {
    const res = {
        headers: {},
        statusCode: 200,
        finished: false,
        locals: {},
        setHeader(name, value) {
            this.headers[String(name).toLowerCase()] = value;
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            this.finished = true;
            return this;
        }
    };
    return res;
};
const invokeNodeRoute = async (handlers, principal) => {
    const overrides = principal
        ? {
            principal: {
                id: principal.id,
                roles: principal.roles,
                type: 'service',
                source: 'dev'
            }
        }
        : {};
    const req = createMockRequest(overrides);
    const res = createMockResponse();
    await runHandlers(handlers, req, res);
    return res;
};
describe('memoryRoutes auth + pii redaction', () => {
    let service;
    let nodeFixture;
    let handlers;
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
        const router = (0, memoryRoutes_1.default)(service);
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
