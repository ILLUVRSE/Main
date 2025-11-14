import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import memoryRoutes from './routes/memoryRoutes';
import { VectorDbAdapter } from './vector/vectorDbAdapter';
import { createMemoryService } from './services/memoryService';
import { getPool } from './db';

const app = express();
app.use(express.json({ limit: '2mb' }));

const vectorAdapter = new VectorDbAdapter({
  provider: process.env.VECTOR_DB_PROVIDER,
  endpoint: process.env.VECTOR_DB_ENDPOINT,
  apiKey: process.env.VECTOR_DB_API_KEY,
  namespace: process.env.VECTOR_DB_NAMESPACE ?? 'kernel-memory',
  pool: getPool()
});

const memoryService = createMemoryService({ vectorAdapter });

app.get('/healthz', async (_req: Request, res: Response) => {
  try {
    await getPool().query('SELECT 1');
    const vectorStatus = await vectorAdapter.healthCheck();
    res.json({
      status: 'ok',
      vector: vectorStatus
    });
  } catch (err) {
    console.error('[healthz] failed', err);
    res.status(500).json({ status: 'error', message: (err as Error).message });
  }
});

app.get('/readyz', async (_req: Request, res: Response) => {
  try {
    const vectorStatus = await vectorAdapter.healthCheck();
    res.json({
      status: 'ready',
      vector: vectorStatus
    });
  } catch (err) {
    res.status(503).json({ status: 'degraded', message: (err as Error).message });
  }
});

app.use('/v1', memoryRoutes(memoryService));

// Simple error handler so the scaffold surfaces JSON errors.
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[memory-layer] request failed', err);
  res.status(err.status ?? 500).json({
    error: {
      message: err.message
    }
  });
});

const port = Number(process.env.PORT ?? 4300);

if (require.main === module) {
  app.listen(port, () => {
    console.info(`Memory Layer service listening on port ${port}`);
  });
}

export default app;
