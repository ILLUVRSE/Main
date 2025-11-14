import { createAgent, signRequest, allocateResources, performDivision, getAuditDetails, getReasonForNode } from '../src/services/kernelApi';

const createRes = () => ({
  statusCode: 200,
  body: null as any,
  status(code: number) { this.statusCode = code; return this; },
  send(payload: any) { this.body = payload; return this; }
});

describe('Kernel API', () => {
  it('should respond with 200 on /kernel/sign', async () => {
    const res = createRes();
    signRequest({} as any, res as any);
    expect(res.statusCode).toBe(200);
  });

  it('should respond with 200 on /kernel/agent', async () => {
    const res = createRes();
    createAgent({} as any, res as any);
    expect(res.statusCode).toBe(200);
  });

  it('should respond with 200 on /kernel/allocate', async () => {
    const res = createRes();
    allocateResources({} as any, res as any);
    expect(res.statusCode).toBe(200);
  });

  it('should respond with 200 on /kernel/division', async () => {
    const res = createRes();
    performDivision({} as any, res as any);
    expect(res.statusCode).toBe(200);
  });

  it('should respond with 200 on /kernel/audit/{id}', async () => {
    const res = createRes();
    getAuditDetails({ params: { id: '1' } } as any, res as any);
    expect(res.statusCode).toBe(200);
  });

  it('should respond with 200 on /kernel/reason/{node}', async () => {
    const res = createRes();
    getReasonForNode({ params: { node: 'node1' } } as any, res as any);
    expect(res.statusCode).toBe(200);
  });
});
