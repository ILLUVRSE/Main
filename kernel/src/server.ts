/**
 * kernel/src/server.ts
 *
 * Entrypoint for the Kernel HTTP server.
 *
 * Updated OpenAPI validator loading to use dynamic require and robust export
 * discovery to handle multiple package export shapes (named export, default export,
 * or module-as-constructor). This avoids runtime "reading 'default' of undefined"
 * errors when the installed `express-openapi-validator` has a different module shape.
 */

import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import createKernelRouter from './routes/kernelRoutes';
import { waitForDb, runMigrations } from './db';

const PORT = Number(process.env.PORT || 3000);
const OPENAPI_PATH = process.env.OPENAPI_PATH
  ? path.resolve(process.cwd(), process.env.OPENAPI_PATH)
  : path.resolve(__dirname, '../openapi.yaml');

async function createApp() {
  const app = express();
  app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));

  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.debug(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });

  // Load OpenAPI spec when present and install validation middleware
  if (fs.existsSync(OPENAPI_PATH)) {
    try {
      const raw = fs.readFileSync(OPENAPI_PATH, 'utf8');
      const apiSpec = yaml.load(raw) as object;

      // Dynamically require express-openapi-validator and try to discover the Validator constructor
      // across different module export shapes:
      //  - module.OpenApiValidator (named export)
      //  - module.default (default export)
      //  - module (module itself is the constructor)
      // Use require to avoid TypeScript/ESM interop pitfalls.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const OpenApiValidatorModule: any = require('express-openapi-validator');
      const ValidatorCtor: any =
        OpenApiValidatorModule?.OpenApiValidator ||
        OpenApiValidatorModule?.default ||
        OpenApiValidatorModule;

      if (!ValidatorCtor || typeof ValidatorCtor !== 'function') {
        throw new Error('express-openapi-validator export shape not recognized');
      }

      // Instantiate and install validator
      // The validator may be a class or a function returning an object with `install`.
      // Treat it as a constructor for the common case.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instance: any = new ValidatorCtor({
        apiSpec,
        validateRequests: true,
        validateResponses: false, // keep response validation off for now
      });

      // The installer returns a promise when calling `install(app)`
      if (typeof instance.install === 'function') {
        await instance.install(app);
        console.info(`OpenAPI validation enabled using ${OPENAPI_PATH}`);
      } else {
        throw new Error('OpenApiValidator instance does not expose install(app)');
      }
    } catch (err) {
      console.warn('Failed to load/install OpenAPI validator:', (err as Error).message || err);
    }
  } else {
    console.warn(`OpenAPI not found at ${OPENAPI_PATH} — request validation disabled.`);
  }

  app.use('/', createKernelRouter());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err && err.stack ? err.stack : err);
    if (err?.status && err?.errors) {
      return res.status(err.status).json({ error: 'validation_error', details: err.errors });
    }
    return res.status(err?.status || 500).json({ error: err?.message || 'internal_error' });
  });

  return app;
}

async function start() {
  try {
    console.log('Kernel server starting...');
    console.log('Waiting for Postgres...');
    await waitForDb(30_000, 500);

    try {
      console.log('Applying migrations...');
      await runMigrations();
      console.log('Migrations applied.');
    } catch (err) {
      console.warn('Migration runner failed (continuing):', (err as Error).message || err);
    }

    const app = await createApp();
    const server = app.listen(PORT, () => {
      console.log(`Kernel server listening on port ${PORT}`);
    });

    const shutdown = async () => {
      console.log('Shutting down Kernel server...');
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
      setTimeout(() => {
        console.warn('Forcing shutdown.');
        process.exit(1);
      }, 10_000).unref();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Fatal error starting Kernel server:', (err as Error).message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

export { createApp };

/**
 * Acceptance criteria (short, testable):
 *
 * - OpenAPI validator is loaded when kernel/openapi.yaml exists, and the server does not crash
 *   if the validator module uses a different export shape. Test by starting server with different
 *   installed versions of express-openapi-validator.
 *
 * - When OpenAPI validator is available and installed, invalid requests are rejected with 400
 *   and validation details.
 *
 * - All previous server behaviors remain unchanged (mounting router, health endpoint, graceful shutdown).
 */

