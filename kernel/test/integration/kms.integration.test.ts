// kernel/test/integration/kms.integration.test.ts
import { EventEmitter } from 'events';
import * as http from 'http';
import fetchNode from 'node-fetch';
import { probeKmsReachable } from '../../src/services/kms';

function createFakeRequest(
  cb: (res: http.IncomingMessage) => void,
  opts: { succeed: boolean }
): http.ClientRequest {
  const res = new EventEmitter() as http.IncomingMessage;
  const req = new EventEmitter() as any;
  req.end = (..._args: any[]) => {
    setImmediate(() => {
      if (opts.succeed) {
        cb(res);
        res.emit('data', Buffer.from('ok'));
        res.emit('end');
      } else {
        req.emit('error', new Error('unreachable'));
      }
    });
    return req;
  };
  req.destroy = () => req;
  req.setTimeout = () => req;
  return req as http.ClientRequest;
}

describe('KMS reachability (probeKmsReachable)', () => {
  beforeEach(() => {
    jest.resetModules();
    if (!(globalThis as any).fetch) {
      // @ts-ignore node-fetch fallback for runtimes without global fetch
      globalThis.fetch = fetchNode;
    }
  });

  test('returns true for reachable HTTP endpoint', async () => {
    const ok = await probeKmsReachable('http://kms.local/health', 2000, {
      http: (_options, cb) => createFakeRequest(cb, { succeed: true }),
    });
    expect(ok).toBe(true);
  });

  test('returns false for unreachable endpoint', async () => {
    const ok = await probeKmsReachable('http://kms.local/health', 500, {
      http: (_options, cb) => createFakeRequest(cb, { succeed: false }),
    });
    expect(ok).toBe(false);
  });
});
