/**
 * Lightweight adapter that exposes createAppSync / createApp / app
 * by delegating to kernel/dist/server. This tolerates multiple shapes
 * the compiled server may be exported as, and makes tests resilient.
 *
 * Tests in this repo often `require('../utils/testApp')` and expect at
 * least one of createAppSync/createApp/app to be available. This adapter
 * simply forwards to what the compiled server exports.
 */

type MaybeApp = any;

function loadServer(): any {
  // During Jest runs we prefer the TypeScript source so we never rely on a stale build.
  const preferSrc = Boolean(process.env.JEST_WORKER_ID);
  const candidates = preferSrc
    ? ['../../src/server', '../../dist/server']
    : ['../../dist/server', '../../src/server'];

  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(candidate);
    } catch (err) {
      errors.push(`${candidate}: ${(err as Error).message}`);
    }
  }

  throw new Error(
    `Failed to load kernel server entrypoint from any candidate (${candidates.join(
      ', '
    )}). Underlying errors: ${errors.join(' | ')}`
  );
}

const srv = loadServer();

// Normalization helpers -----------------------------------------------------

/** Return the express app if available */
function pickAppFromServer(s: any): MaybeApp | undefined {
  if (!s) return undefined;
  // s might itself be an express app, or an object exposing `app`, or a module with createAppSync/createApp
  if (typeof s === 'function' && (s.use || s.handle)) return s;
  if (s.app && typeof s.app === 'function' && (s.app.use || s.app.handle)) return s.app;
  if (s.default && s.default.app && (s.default.app.use || s.default.app.handle)) return s.default.app;
  return undefined;
}

/** Return exported functions if present */
function pickCreators(s: any) {
  return {
    createAppSync: typeof s.createAppSync === 'function' ? s.createAppSync : (s.default && typeof s.default.createAppSync === 'function' ? s.default.createAppSync : undefined),
    createApp: typeof s.createApp === 'function' ? s.createApp : (s.default && typeof s.default.createApp === 'function' ? s.default.createApp : undefined),
  };
}

// Public exports ------------------------------------------------------------

const creators = pickCreators(srv);
const exportedApp = pickAppFromServer(srv) || (srv.default ? pickAppFromServer(srv.default) : undefined);

export function createAppSync(): any {
  // Prefer explicit createAppSync if available
  if (creators.createAppSync) return creators.createAppSync();
  // Otherwise if an app is directly exported, return it
  if (exportedApp) return exportedApp;
  // Otherwise try createApp and unwrap
  if (creators.createApp) {
    const maybe = creators.createApp();
    // createApp could return { app } or app directly or a Promise
    if ((maybe as Promise<any>).then) {
      // If it returns a promise, we can't synchronously wait here — throw helpful error
      throw new Error('createAppSync: server.createApp returned a Promise; call createApp instead from tests.');
    }
    return (maybe && (maybe.app || maybe)) || maybe;
  }
  // As a last resort, try srv.app
  if (srv && (srv.app || (srv.default && srv.default.app))) return srv.app || srv.default.app;
  throw new Error('createAppSync: no app available from kernel/dist/server');
}

export async function createApp(): Promise<any> {
  if (creators.createApp) {
    const created = await creators.createApp();
    return created?.app || created;
  }
  if (creators.createAppSync) {
    return creators.createAppSync();
  }
  if (exportedApp) return exportedApp;
  if (srv && (srv.app || (srv.default && srv.default.app))) return srv.app || srv.default.app;
  throw new Error('createApp: no createApp/createAppSync/app available on kernel/dist/server');
}

// Also export `app` if directly available so tests that require testApp.app work.
export const app = exportedApp || undefined;

// Default export supporting older require() patterns
export default {
  createAppSync,
  createApp,
  app,
};

export { createApp as createTestApp, createAppSync as createTestAppSync };
