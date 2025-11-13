// server/src/middleware/idempotency.ts
import path from 'path';
import { readJson, writeJsonAtomic } from '../utils/storage';

const IDEMP_PATH = path.resolve(process.cwd(), 'data', 'idempotency.json');

export function idempotencyMiddleware() {
  return async (req:any, res:any, next:any) => {
    // only for write endpoints: POST, PUT, PATCH, DELETE
    if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();

    const key = (req.headers['idempotency-key'] || '').toString().trim();
    if (!key) return next();

    await ensureIdemStore();

    const store = await readJson<Record<string, any>>(IDEMP_PATH, {});
    if (store[key]) {
      // replay stored response
      const entry = store[key];
      res.status(entry.status).json(entry.body);
      return;
    }

    // intercept json send to persist response
    const origJson = res.json.bind(res);
    res.json = (body: any) => {
      const rec = { status: res.statusCode || 200, body };
      store[key] = rec;
      // persist asynchronously (but keep response deterministic)
      return writeJsonAtomic(IDEMP_PATH, store)
        .catch(err => console.error('idempotency write failed', err))
        .then(() => origJson(body));
    };

    next();
  };
}

async function ensureIdemStore() {
  try {
    await readJson(IDEMP_PATH, {});
  } catch (e) {
    await writeJsonAtomic(IDEMP_PATH, {});
  }
}
