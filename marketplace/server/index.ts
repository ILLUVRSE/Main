import dotenv from 'dotenv';
import http from 'http';
import app from './app';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Marketplace service listening on http://0.0.0.0:${PORT} (env=${process.env.NODE_ENV || 'development'})`);
});

/**
 * Graceful shutdown
 */
function shutdown(signal: string) {
  console.info(`Received ${signal}, closing HTTP server...`);
  server.close((err?: Error) => {
    if (err) {
      console.error('Error during server close:', err);
      process.exit(1);
    }
    console.info('HTTP server closed. Exiting.');
    process.exit(0);
  });

  // Force exit after timeout
  setTimeout(() => {
    console.warn('Forcing shutdown after timeout.');
    process.exit(1);
  }, 30_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/**
 * Uncaught exception / unhandled rejection handling to avoid silent crashes.
 */
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception', err);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason);
  shutdown('unhandledRejection');
});

