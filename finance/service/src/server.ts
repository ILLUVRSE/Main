import dotenv from 'dotenv';
import app from './app';
import { loadConfig } from './server/config';

dotenv.config();

const config = loadConfig();
const port = config.port;

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[finance] listening on http://0.0.0.0:${port}`);
});

function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.info(`[finance] received ${signal}, closing server...`);
  server.close((err) => {
    if (err) {
      console.error('[finance] error during shutdown', err);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
