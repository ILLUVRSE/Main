import { helloHandler } from '../services/api';

describe('GET /api/hello', () => {
    it('should return 200 and a message', async () => {
        const res = {
            statusCode: 200,
            body: null as any,
            status(code: number) { this.statusCode = code; return this; },
            json(payload: any) { this.body = payload; return this; }
        };
        helloHandler({} as any, res as any);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ msg: 'hello' });
    });
});
