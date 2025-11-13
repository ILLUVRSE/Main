// server/src/index.ts
// Entrypoint for codex-server (IDEA). Mounts Creator API routes and core middleware.

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

import packageRouter from './routes/package';
import kernelRouter from './routes/kernel';
import sandboxRouter from './routes/sandbox';
import agentRouter from './routes/agent';
import gitRouter from './routes/git'; // existing
import ideaRouter from './routes/idea'; // optional existing route

import { idempotencyMiddleware } from './middleware/idempotency';

// IMPORTANT: ensure rawBody is captured for signature verification endpoints.
const app = express();

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN ?? 'http://127.0.0.1:5173',
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  credentials: true
}));

// capture raw body for signature verification (kernel callback)
app.use(express.json({
  verify: (req:any, _res, buf) => {
    req.rawBody = buf;
  },
  limit: '10mb'
}));

// request id / logger
app.use((req:any, _res, next) => {
  const id = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
  req.request_id = id;
  console.log(`[req] ${id} ${req.method} ${req.url}`);
  const start = Date.now();
  resOnFinish(_res, () => {
    const duration = Date.now() - start;
    console.log(JSON.stringify({
      event: 'request_end',
      request_id: id,
      method: req.method,
      url: req.url,
      duration_ms: duration,
      status: (_res as any).statusCode
    }));
  });
  next();
});

function resOnFinish(res:any, cb:() => void) {
  res.on && res.on('finish', cb);
}

// idempotency middleware (global)
app.use(idempotencyMiddleware());

// Mount Creator API routers
app.use('/api/v1', packageRouter);
app.use('/api/v1', kernelRouter);
app.use('/api/v1', sandboxRouter);
app.use('/api/v1', agentRouter);

// Mount existing git/idea routes if present (keep compatibility)
try {
  app.use('/git', gitRouter);
} catch (e) {
  // noop if not present
}
try {
  app.use('/api/v1', ideaRouter);
} catch (e) {
  // noop if not present
}

// simple health
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.send('codex server (IDEA)'));

// error handler
app.use((err:any, _req:any, res:any, _next:any) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  res.status(500).json({ ok: false, error: { code: 'server_error', message: 'internal_server_error' }});
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5175;
const HOST = process.env.HOST || '127.0.0.1';

let server: ReturnType<typeof app.listen> | null = null;

if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, HOST, () => {
    console.log(`[codex] server listening on http://${HOST}:${PORT}`);
  });

  // graceful shutdown
  const shutdown = () => {
    console.log('Shutting down server...');
    server?.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export { server };
export default app;
