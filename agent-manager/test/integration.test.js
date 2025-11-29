// agent-manager/test/integration.test.js
const request = require('supertest');
const app = require('../server/index');
const { v4: uuidv4 } = require('uuid');

describe('Agent Lifecycle Integration Tests', () => {
  let agentId;

  it('Spawn: should create a new agent', async () => {
    const res = await request(app)
      .post('/api/v1/agent/spawn')
      .send({
        agent_config: { name: 'test-agent', profile: 'default' }
      });
    expect(res.statusCode).toEqual(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.agent_id).toBeDefined();
    agentId = res.body.agent_id;
  });

  it('Spawn: should be idempotent', async () => {
    const res = await request(app)
      .post('/api/v1/agent/spawn')
      .send({
        agent_id: agentId,
        agent_config: { name: 'test-agent', profile: 'default' }
      });
    // Assuming idempotency returns 201 or 200 with same ID
    expect(res.statusCode).toBeLessThan(300);
    expect(res.body.agent_id).toEqual(agentId);
  });

  it('Start: should start the agent', async () => {
    const res = await request(app)
      .post(`/api/v1/agent/${agentId}/start`)
      .send({});
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('running');
  });

  it('Stop: should stop the agent', async () => {
    const res = await request(app)
      .post(`/api/v1/agent/${agentId}/stop`)
      .send({});
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('stopped');
  });

  it('Restart: should restart the agent', async () => {
    const res = await request(app)
      .post(`/api/v1/agent/${agentId}/restart`)
      .send({});
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('restarting');
  });

  it('Scale: should scale the agent', async () => {
    const res = await request(app)
      .post(`/api/v1/agent/${agentId}/scale`)
      .send({ replicas: 3 });
    expect(res.statusCode).toEqual(200);
    expect(res.body.replicas).toEqual(3);
  });
});
