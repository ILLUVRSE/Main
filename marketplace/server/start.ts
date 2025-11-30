import { startServer } from './server';
import logger from './lib/logger';
import settingsService from './lib/settingsService';

(async () => {
  try {
    // await settingsService.getAll(); // warm settings
    await startServer();
  } catch (err) {
    logger.error('server.boot.failed', { err });
    process.exit(1);
  }
})();
