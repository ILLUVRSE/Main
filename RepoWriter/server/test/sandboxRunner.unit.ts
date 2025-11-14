import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app'; // Assuming you have an app.js or index.js that exports your Express app

describe('Agent Lifecycle', () => {
    let agentId;

    it('should spawn an agent', async () => {
        const response = await request(app).post('/api/v1/agent/spawn');
        expect(response.status).toBe(201);
        agentId = response.body.agent_id;
    });

    it('should start the agent', async () => {
        const response = await request(app).post(`/api/v1/agent/${agentId}/start`);
        expect(response.status).toBe(200);
        expect(response.text).toBe('Started');
    });

    it('should stop the agent', async () => {
        const response = await request(app).post(`/api/v1/agent/${agentId}/stop`);
        expect(response.status).toBe(200);
        expect(response.text).toBe('Stopped');
    });

    it('should restart the agent', async () => {
        const response = await request(app).post(`/api/v1/agent/${agentId}/restart`);
        expect(response.status).toBe(200);
        expect(response.text).toBe('Restarted');
    });

    it('should scale the agent', async () => {
        const response = await request(app).post(`/api/v1/agent/${agentId}/scale`);
        expect(response.status).toBe(200);
        expect(response.text).toBe('Scaled');
    });
});