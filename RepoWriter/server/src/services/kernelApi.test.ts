import { createAgent, signRequest, allocateResources, performDivision, getAuditDetails, getReasonForNode } from '../services/kernelApi';

function createMockRes() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: any) {
      this.body = payload;
      return this;
    }
  };
}

describe('Kernel API', () => {
  it('should sign a request', async () => {
    const res = createMockRes();
    signRequest({} as any, res as any);
    expect(res.statusCode).toBe(200);
  });

  it('should create an agent', async () => {
    const res = createMockRes();
    createAgent({} as any, res as any);
    expect(res.statusCode).toBe(200);
  });

  it('should allocate resources', async () => {
    const res = createMockRes();
    allocateResources({} as any, res as any);
    expect(res.statusCode).toBe(200);
  });

  it('should perform division operation', async () => {
    const res = createMockRes();
    performDivision({} as any, res as any);
    expect(res.statusCode).toBe(200);
  });

  it('should get audit details', async () => {
    const res = createMockRes();
    getAuditDetails({ params: { id: '1' } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('1');
  });

  it('should get reason for a node', async () => {
    const res = createMockRes();
    getReasonForNode({ params: { node: 'node1' } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('node1');
  });
});
