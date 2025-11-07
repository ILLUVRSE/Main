// kernel/test/middleware/errorHandler.test.ts
import { errorHandler } from '../../src/middleware/errorHandler';
import logger from '../../src/logger';

describe('errorHandler middleware', () => {
  beforeEach(() => {
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('maps unauthenticated errors to 401 with structured body', () => {
    const err: any = new Error('unauthenticated');
    err.code = 'unauthenticated';

    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res: any = { status };

    errorHandler(err, {} as any, res, jest.fn());

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'unauthenticated' }));
  });

  test('includes stack in non-production mode', () => {
    const err = new Error('boom');
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res: any = { status };

    errorHandler(err, {} as any, res, jest.fn());

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ stack: expect.any(Array) }));
  });
});

