import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import querystring from 'querystring';

type HeaderValue = string | number | string[];

type RequestOptions = {
  method: string;
  path: string;
  queryString: string;
  headers: Record<string, HeaderValue>;
  bodyBuffer: Buffer | null;
  rawBody?: any;
};

type ResponseResult = {
  status: number;
  statusCode: number;
  headers: Record<string, HeaderValue>;
  text: string;
  body: any;
};

const DEFAULT_HOST = 'mock.local';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;

function isPromise<T = unknown>(value: any): value is Promise<T> {
  return Boolean(value && typeof value.then === 'function');
}

function resolveApp(appLike: any): any {
  if (!appLike) throw new Error('mockSupertest: no app provided');
  if (typeof appLike === 'function' && (appLike.handle || appLike.use)) return appLike;
  if (appLike && typeof appLike.app === 'function') return resolveApp(appLike.app);
  if (typeof appLike.address === 'function') return appLike;
  if (typeof appLike === 'function') {
    const result = appLike();
    if (isPromise(result)) {
      throw new Error('mockSupertest: provided a factory that returns a Promise; pass the app/server directly or await the factory in your test.');
    }
    return resolveApp(result);
  }
  throw new Error('mockSupertest: expected an express app, router, or server-like object.');
}

function toBuffer(payload: any): Buffer | null {
  if (payload === undefined || payload === null) return null;
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === 'object') {
    return Buffer.from(JSON.stringify(payload), 'utf8');
  }
  return Buffer.from(String(payload), 'utf8');
}

function buildUrl(path: string, queryString: string): string {
  if (!queryString) return path;
  return path.includes('?') ? `${path}&${queryString}` : `${path}?${queryString}`;
}

function normalizeHeaders(headers: Record<string, HeaderValue>): Record<string, HeaderValue> {
  const out: Record<string, HeaderValue> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = Array.isArray(value)
      ? value.map((v) => (typeof v === 'number' ? String(v) : v))
      : typeof value === 'number'
        ? String(value)
        : value;
  }
  if (!out.host) out.host = DEFAULT_HOST;
  return out;
}

class MockConnection extends EventEmitter {
  encrypted = false;
  remoteAddress = '127.0.0.1';
  remotePort = 0;

  setTimeout(): this {
    return this;
  }

  setNoDelay(): this {
    return this;
  }

  setKeepAlive(): this {
    return this;
  }
}

class MockRequest extends Readable {
  headers: Record<string, HeaderValue>;
  rawHeaders: string[];
  method: string;
  url: string;
  originalUrl: string;
  path: string;
  protocol = 'http';
  secure = false;
  connection: MockConnection;
  socket: MockConnection;
  ips: string[] = [];
  ip = '127.0.0.1';
  params: Record<string, string> = {};
  query: Record<string, any> = {};
  baseUrl = '';
  body?: any;
  complete = true;
  app: any;
  res: any;

  private bodyBuffer: Buffer | null;

  constructor(options: RequestOptions) {
    super();
    this.method = options.method;
    this.url = buildUrl(options.path, options.queryString);
    this.originalUrl = this.url;
    this.path = options.path;
    this.headers = normalizeHeaders(options.headers);
    this.rawHeaders = [];
    for (const [key, value] of Object.entries(this.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          this.rawHeaders.push(key);
          this.rawHeaders.push(String(v));
        }
      } else if (value !== undefined) {
        this.rawHeaders.push(key);
        this.rawHeaders.push(String(value));
      }
    }
    this.bodyBuffer = options.bodyBuffer;
    if (options.rawBody !== undefined) {
      (this as any).body = options.rawBody;
      (this as any)._body = true;
    }
    if (this.bodyBuffer) {
      this.headers['content-length'] = Buffer.byteLength(this.bodyBuffer).toString();
    }
    this.connection = new MockConnection();
    this.socket = this.connection;
    this.query = options.queryString ? (querystring.parse(options.queryString) as Record<string, any>) : {};
  }

  get(name: string): any {
    return this.header(name);
  }

  header(name: string): any {
    if (!name) return undefined;
    return this.headers[name.toLowerCase()];
  }

  setTimeout(): this {
    return this;
  }

  _read: Readable['_read'] = () => {
    if (this.bodyBuffer) {
      this.push(this.bodyBuffer);
      this.bodyBuffer = null;
    }
    this.push(null);
  };

}

class MockResponse extends Writable {
  statusCode = 200;
  statusMessage = 'OK';
  locals: Record<string, any> = {};
  headersSent = false;
  finished = false;
  req: MockRequest | null = null;
  app: any;

  private headerStore: Record<string, HeaderValue> = {};
  private chunks: Buffer[] = [];
  private result: ResponseResult | null = null;

  constructor(appInstance: any) {
    super();
    this.app = appInstance;
    this.on('finish', () => {
      this.finished = true;
      this.headersSent = true;
      if (!this.result) {
        this.result = this.buildResult();
      }
    });
  }

  _write: Writable['_write'] = (chunk, encoding, callback) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding);
    this.chunks.push(buf);
    callback();
  };

  setHeader = (field: string, value: HeaderValue): void => {
    this.headerStore[field.toLowerCase()] = value;
  };

  getHeader = (field: string): HeaderValue | undefined => {
    return this.headerStore[field.toLowerCase()];
  };

  removeHeader = (field: string): void => {
    delete this.headerStore[field.toLowerCase()];
  };

  getHeaders = (): Record<string, HeaderValue> => {
    return { ...this.headerStore };
  };

  header = (field: string, value?: HeaderValue): any => {
    if (value === undefined) return this.getHeader(field);
    this.setHeader(field, value);
    return this;
  };

  writeHead = (
    statusCode: number,
    reasonOrHeaders?: string | Record<string, HeaderValue>,
    headersMaybe?: Record<string, HeaderValue>,
  ): this => {
    this.statusCode = statusCode;
    if (typeof reasonOrHeaders === 'string') {
      this.statusMessage = reasonOrHeaders;
      if (headersMaybe) {
        for (const [k, v] of Object.entries(headersMaybe)) this.setHeader(k, v);
      }
    } else if (reasonOrHeaders) {
      for (const [k, v] of Object.entries(reasonOrHeaders)) this.setHeader(k, v);
    }
    return this;
  };

  end = (...args: any[]): this => {
    if (this.finished) return this;
    this.headersSent = true;
    Writable.prototype.end.apply(this, args as any);
    return this;
  };

  private buildResult = (): ResponseResult => {
    if (this.result) return this.result;
    const buffer = Buffer.concat(this.chunks);
    const text = buffer.toString('utf8');
    const headers = { ...this.headerStore };
    const contentType = (
      (this.getHeader('content-type') || this.getHeader('Content-Type') || '') as string
    )
      .toString()
      .toLowerCase();
    let body: any = text;
    if (contentType.includes('application/json')) {
      if (text.length) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      } else {
        body = {};
      }
    }
    this.result = {
      status: this.statusCode,
      statusCode: this.statusCode,
      headers,
      text,
      body,
    };
    return this.result;
  };

  getResult = (): ResponseResult => {
    return this.result ?? this.buildResult();
  };
}

async function dispatch(app: any, options: RequestOptions): Promise<ResponseResult> {
  const handler = resolveApp(app);

  if (handler && typeof handler.address === 'function') {
    throw new Error('mockSupertest: server instances are not supported without sockets; pass the express app instead.');
  }

  const req = new MockRequest(options);
  const res = new MockResponse(handler);
  req.app = handler;
  res.app = handler;
  req.res = res;
  res.req = req;

  if (options.rawBody !== undefined) {
    (req as any).body = options.rawBody;
    (req as any)._body = true;
  }
  if (options.bodyBuffer) {
    (req as any).rawBody = options.bodyBuffer;
  }

  return new Promise<ResponseResult>((resolve, reject) => {
    const cleanup = (err?: any) => {
      if (err) {
        reject(err);
      } else if (!res.finished) {
        res.end();
      }
    };

    res.once('finish', () => {
      try {
        resolve(res.getResult());
      } catch (err) {
        reject(err);
      }
    });
    res.once('error', reject);

    try {
      const maybe = handler(req, res, cleanup);
      if (isPromise(maybe)) {
        maybe.then(() => {
          if (!res.finished) res.end();
        }).catch(cleanup);
      }
    } catch (err) {
      reject(err);
    }
  });
}

class PendingRequest<TResponse extends ResponseResult = ResponseResult> implements Promise<TResponse> {
  [Symbol.toStringTag] = 'Promise';

  private headers: Record<string, HeaderValue> = {};
  private payload: any;
  private queryParts: string[] = [];
  private expectStatusCode?: number;
  private expectBody?: any;

  constructor(private app: any, private method: string, private path: string) {}

  set(field: string | Record<string, HeaderValue>, value?: HeaderValue): this {
    if (typeof field === 'string') {
      this.headers[field] = value ?? '';
      return this;
    }
    Object.assign(this.headers, field);
    return this;
  }

  query(value: Record<string, any> | string): this {
    if (typeof value === 'string') {
      this.queryParts.push(value.replace(/^\?/, ''));
    } else {
      this.queryParts.push(querystring.stringify(value));
    }
    return this;
  }

  send(body: any): this {
    this.payload = body;
    return this;
  }

  expect(status: number, body?: any): this {
    this.expectStatusCode = status;
    if (body !== undefined) {
      this.expectBody = body;
    }
    return this;
  }

  then<TResult1 = TResponse, TResult2 = never>(
    onfulfilled?: ((value: TResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null,
  ): Promise<TResponse | TResult> {
    return this.execute().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<TResponse> {
    return this.execute().finally(onfinally ?? undefined);
  }

  private async execute(): Promise<TResponse> {
    const headers = { ...this.headers };
    let bodyBuffer = toBuffer(this.payload);
    const rawBody =
      this.payload && typeof this.payload === 'object' && !Buffer.isBuffer(this.payload)
        ? this.payload
        : undefined;
    const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
    if (bodyBuffer && !hasContentType) {
      const defaultType =
        typeof this.payload === 'object' && !Buffer.isBuffer(this.payload)
          ? 'application/json; charset=utf-8'
          : 'text/plain; charset=utf-8';
      headers['content-type'] = defaultType;
    }
    const mergedQuery = this.queryParts.filter(Boolean).join('&');
    const response = await dispatch(this.app, {
      method: this.method,
      path: this.path,
      queryString: mergedQuery,
      headers,
      bodyBuffer,
      rawBody,
    });

    if (this.expectStatusCode !== undefined && response.status !== this.expectStatusCode) {
      throw new Error(`Expected status ${this.expectStatusCode} but received ${response.status}`);
    }

    if (this.expectBody !== undefined) {
      expect(response.body).toEqual(this.expectBody);
    }

    return response as TResponse;
  }
}

class RequestFactory {
  constructor(private app: any) {
    for (const method of HTTP_METHODS) {
      (this as any)[method.toLowerCase()] = (path: string) => new PendingRequest(app, method, path);
    }
  }
}

export type MockSupertestResponse = ResponseResult;

export default function request(appLike: any) {
  const app = resolveApp(appLike);
  return new RequestFactory(app) as RequestFactory & {
    get(path: string): PendingRequest;
    post(path: string): PendingRequest;
    put(path: string): PendingRequest;
    patch(path: string): PendingRequest;
    delete(path: string): PendingRequest;
    head(path: string): PendingRequest;
    options(path: string): PendingRequest;
  };
}
