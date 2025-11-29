// agent-manager/test/sandbox.test.js
const request = require('supertest');
const app = require('../server/index');

describe('Sandbox Runner Tests', () => {
  it('should run a simple task and pass', async () => {
    const res = await request(app)
      .post('/api/v1/sandbox/run')
      .send({
        agent_id: 'test-agent',
        task_payload: {
            code: 'result = 1 + 1;',
            timeout: 1000
        }
      });
    if (res.body.result.status !== 'passed') {
      console.log('Sandbox logs:', res.body.result.logs);
    }
    expect(res.statusCode).toEqual(200);
    expect(res.body.result.status).toEqual('passed');
    expect(res.body.result.output).toEqual(2);
  });

  it('should handle errors in task', async () => {
    const res = await request(app)
      .post('/api/v1/sandbox/run')
      .send({
        agent_id: 'test-agent',
        task_payload: {
            code: 'throw new Error("fail");',
            timeout: 1000
        }
      });
    if (res.body.result.status !== 'failed') {
        console.log('Sandbox logs:', res.body.result.logs);
    }
    expect(res.statusCode).toEqual(200); // 200 OK because the RUNNER executed fine, but the task failed
    expect(res.body.result.status).toEqual('failed');
    expect(res.body.result.error).toContain('fail');
  });

  it('should timeout if task takes too long', async () => {
    const res = await request(app)
      .post('/api/v1/sandbox/run')
      .send({
        agent_id: 'test-agent',
        task_payload: {
            code: 'while(true);', // Infinite loop
            timeout: 500
        }
      });
    expect(res.statusCode).toEqual(200);
    expect(res.body.result.status).toEqual('timeout');
  });
});
