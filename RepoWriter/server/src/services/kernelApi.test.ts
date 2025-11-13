import request from 'supertest';
import app from '../app'; // Assuming your Express app is exported from app.js

describe('Kernel API', () => {
  it('should sign a request', async () => {
    const response = await request(app).post('/kernel/sign');
    expect(response.status).toBe(200);
  });

  it('should create an agent', async () => {
    const response = await request(app).post('/kernel/agent');
    expect(response.status).toBe(200);
  });

  it('should allocate resources', async () => {
    const response = await request(app).post('/kernel/allocate');
    expect(response.status).toBe(200);
  });

  it('should perform division operation', async () => {
    const response = await request(app).post('/kernel/division');
    expect(response.status).toBe(200);
  });

  it('should get audit details', async () => {
    const response = await request(app).get('/kernel/audit/1');
    expect(response.status).toBe(200);
  });

  it('should get reason for a node', async () => {
    const response = await request(app).get('/kernel/reason/node1');
    expect(response.status).toBe(200);
  });
});