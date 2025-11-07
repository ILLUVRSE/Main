// kernel/test/middleware/tracing.test.ts
import { tracingMiddleware, getCurrentTraceId } from '../../src/middleware/tracing';

describe('tracing middleware', () => {
  test('generates a trace id when header missing', (done) => {
    const req: any = { header: () => undefined };
    const res: any = { setHeader: jest.fn(), locals: {} };

    tracingMiddleware(req, res, () => {
      const traceId = getCurrentTraceId();
      expect(typeof traceId).toBe('string');
      expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', traceId);
      expect(res.locals.traceId).toBe(traceId);
      done();
    });
  });

  test('propagates valid incoming header', (done) => {
    const req: any = { header: (name: string) => (name.toLowerCase() === 'x-trace-id' ? 'abc12345' : undefined) };
    const res: any = { setHeader: jest.fn(), locals: {} };

    tracingMiddleware(req, res, () => {
      const traceId = getCurrentTraceId();
      expect(traceId).toBe('abc12345');
      expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', 'abc12345');
      done();
    });
  });
});

