import { createServer, request as httpRequest } from 'http';

class RequestBuilder {
  constructor(app, method, url) {
    this.app = app;
    this.method = method;
    this.url = url;
    this.headers = {};
    this.body = undefined;
    this._promise = null;
  }

  set(name, value) {
    if (name && typeof name === 'object') {
      Object.entries(name).forEach(([key, val]) => {
        if (typeof key === 'string') {
          this.headers[key.toLowerCase()] = val;
        }
      });
      return this;
    }
    if (typeof name === 'string') {
      this.headers[name.toLowerCase()] = value;
    }
    return this;
  }

  send(payload) {
    this.body = payload;
    if (payload !== null && typeof payload === 'object' && !Buffer.isBuffer(payload)) {
      if (!this.headers['content-type']) {
        this.headers['content-type'] = 'application/json';
      }
    }
    return this;
  }

  expect(statusCode) {
    return this.then((res) => {
      const actual = res.statusCode ?? res.status ?? 0;
      if (typeof statusCode === 'number' && actual !== statusCode) {
        const err = new Error(`Expected status ${statusCode} but received ${actual}`);
        err.response = res;
        throw err;
      }
      return res;
    });
  }

  then(onFulfilled, onRejected) {
    if (!this._promise) {
      this._promise = this.execute();
    }
    return this._promise.then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    if (!this._promise) {
      this._promise = this.execute();
    }
    return this._promise.catch(onRejected);
  }

  finally(onFinally) {
    if (!this._promise) {
      this._promise = this.execute();
    }
    return this._promise.finally(onFinally);
  }

  execute() {
    return new Promise((resolve, reject) => {
      const handler = typeof this.app === 'function' ? this.app : this.app?.handle;
      const server = handler ? createServer(handler) : this.app;
      const shouldClose = Boolean(handler);

      const ensureListening = () => {
        const address = server.address();
        if (typeof address === 'object' && address) {
          performRequest(server, address.port);
        }
      };

      const performRequest = (srv, port) => {
        const options = {
          hostname: '127.0.0.1',
          port,
          path: this.url,
          method: this.method,
          headers: { ...this.headers }
        };

        const req = httpRequest(options, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const text = buffer.toString('utf8');
            let body;
            try {
              body = text ? JSON.parse(text) : undefined;
            } catch {
              body = text;
            }
            if (shouldClose && srv.listening) {
              srv.close();
            }
            resolve({
              status: res.statusCode ?? 0,
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              body,
              text
            });
          });
        });

        req.on('error', (err) => {
          if (shouldClose && srv.listening) {
            srv.close();
          }
          reject(err);
        });

        if (this.body !== undefined) {
          if (typeof this.body === 'string' || Buffer.isBuffer(this.body)) {
            req.write(this.body);
          } else {
            req.write(JSON.stringify(this.body));
          }
        }
        req.end();
      };

      if (!server.listening) {
        server.listen(0, '127.0.0.1', () => ensureListening());
      } else {
        ensureListening();
      }
    });
  }
}

function request(app) {
  return {
    get: (url) => new RequestBuilder(app, 'GET', url),
    post: (url) => new RequestBuilder(app, 'POST', url),
    put: (url) => new RequestBuilder(app, 'PUT', url),
    delete: (url) => new RequestBuilder(app, 'DELETE', url)
  };
}

export default request;
