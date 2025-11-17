import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import logger from './lib/logger';
import settingsService from './lib/settingsService';

// Admin routes
import adminAgents from './routes/admin/agents.route';
import adminAudits from './routes/admin/audits.route';
import adminUsers from './routes/admin/users.route';
import adminSettings from './routes/admin/settings.route';
import adminMarketplace from './routes/admin/marketplace.route';
import adminPayments from './routes/admin/payments.route';
import adminIntegrations from './routes/admin/integrations.route';
import adminJobs from './routes/admin/jobs.route';
// public routes
import marketplace from './routes/marketplace.route';
import payments from './routes/payments.route';
import webhooks from './routes/webhooks.route';

// simple middleware
import { optionalAuth } from './middleware/auth';

const DEFAULT_PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

/**
 * Build the express app instance with routes and middleware.
 */
export function createApp() {
  const app = express();

  // Security & basic middleware
  app.use(helmet());
  app.use(cors());
  app.use(cookieParser());

  // For webhook endpoints we need raw body for signature verification.
  // We'll attach raw-body only for the /webhooks path below to avoid interfering with JSON parsing.
  // Global JSON parser for API
  app.use((req: Request, res: Response, next: NextFunction) => {
    // If request is a webhook (we'll let the webhook router apply raw), skip json parser here
    // but allow other requests to be parsed normally.
    const isWebhook = req.path && req.path.startsWith('/webhooks');
    if (isWebhook) return next();
    // Use express.json with a reasonable limit
    express.json({ limit: '2mb' })(req, res, next);
  });

  // Attach optional auth so handlers can use req.user when provided
  app.use(optionalAuth as any);

  // Mount public API routes
  app.use('/marketplace', marketplace);
  app.use('/payments', payments);

  // Mount webhooks with raw body parser
  app.use('/webhooks', express.raw({ type: '*/*', limit: '1mb' }), (req, res, next) => {
    // attach rawBody for downstream handlers (some platforms set req.rawBody themselves)
    (req as any).rawBody = (req as any).rawBody || req.body;
    next();
  }, webhooks);

  // Admin router aggregator
  const adminRouter = express.Router();
  adminRouter.use('/agents', adminAgents);
  adminRouter.use('/audits', adminAudits);
  adminRouter.use('/users', adminUsers);
  adminRouter.use('/settings', adminSettings);
  adminRouter.use('/marketplace', adminMarketplace);
  adminRouter.use('/payments', adminPayments);
  adminRouter.use('/integrations', adminIntegrations);
  adminRouter.use('/jobs', adminJobs);
  // mount admin router
  app.use('/admin', adminRouter);

  // Health & status
  app.get('/health', (req: Request, res: Response) => res.json({ ok: true }));
  app.get('/status', async (req: Request, res: Response) => {
    try {
      const settings = await settingsService.getAll();
      res.json({
        ok: true,
        uptime: process.uptime(),
        env: settings?.app?.env || process.env.NODE_ENV || 'development',
        appName: settings?.app?.name || 'ILLUVRSE Marketplace',
      });
    } catch (err) {
      logger.error('status.failed', { err });
      res.status(500).json({ ok: false, error: 'status check failed' });
    }
  });

  // 404
  app.use((req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: 'not found' });
  });

  // Error handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('server.error', { err, path: req.path, method: req.method });
    if (res.headersSent) return;
    const status = err && err.status ? err.status : 500;
    res.status(status).json({ ok: false, error: err && err.message ? err.message : 'internal server error' });
  });

  return app;
}

/**
 * Start the HTTP server and return it. This is friendly for tests which may import createApp()
 */
export async function startServer(port?: number) {
  const app = createApp();
  const resolvedPort = port || (await settingsService.get('server.port')) || DEFAULT_PORT;

  const server = http.createServer(app);

  server.listen(Number(resolvedPort), () => {
    logger.info('server.started', { port: Number(resolvedPort) });
  });

  // Graceful shutdown handlers
  const shutdown = () => {
    logger.info('server.shutdown.initiated');
    server.close((err) => {
      if (err) {
        logger.error('server.shutdown.error', { err });
        process.exit(1);
      }
      logger.info('server.shutdown.complete');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

// If invoked directly, start server
if (require.main === module) {
  (async () => {
    try {
      await settingsService.getAll(); // warm settings
      await startServer();
    } catch (err) {
      logger.error('server.boot.failed', { err });
      process.exit(1);
    }
  })();
}

export default createApp();

