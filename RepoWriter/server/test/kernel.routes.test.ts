import request from 'supertest';
import app from '../src/app';

describe('Kernel API', () => {
  it('should respond with 200 on /kernel/sign', async () => {
    const response = await request(app).post('/kernel/sign');
    expect(response.status).toBe(200);
  });

  it('should respond with 200 on /kernel/agent', async () => {
    const response = await request(app).post('/kernel/agent');
    expect(response.status).toBe(200);
  });

  it('should respond with 200 on /kernel/allocate', async () => {
    const response = await request(app).post('/kernel/allocate');
    expect(response.status).toBe(200);
  });

  it('should respond with 200 on /kernel/division', async () => {
    const response = await request(app).post('/kernel/division');
    expect(response.status).toBe(200);
  });

  it('should respond with 200 on /kernel/audit/{id}', async () => {
    const response = await request(app).get('/kernel/audit/1');
    expect(response.status).toBe(200);
  });

  it('should respond with 200 on /kernel/reason/{node}', async () => {
    const response = await request(app).get('/kernel/reason/node1');
    expect(response.status).toBe(200);
  });
});
