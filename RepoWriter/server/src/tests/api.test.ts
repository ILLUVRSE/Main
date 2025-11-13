import request from 'supertest';
import express from 'express';
import apiRouter from '../services/api';

const app = express();
app.use(apiRouter);

describe('GET /api/hello', () => {
    it('should return 200 and a message', async () => {
        const response = await request(app).get('/api/hello');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ msg: 'hello' });
    });
});
