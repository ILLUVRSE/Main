/**
 * RepoWriter/server/index.js
 *
 * Bootstrap for the RepoWriter server.
 *
 * This file resolves the previous deprecation shim and makes RepoWriter the canonical
 * server entrypoint. Behavior:
 *  - If a compiled JS build exists at ./dist/index.js, require and run it.
 *  - Otherwise try to load the TypeScript source at ./src/index.ts using ts-node (on-the-fly transpilation).
 *  - If neither path works, and artifact-publisher is present, warn and fall back to artifact-publisher (compat shim).
 *
 * Notes:
 *  - This file preserves compatibility for local development and Docker images that mount built `dist/`.
 *  - For production, we recommend building the TS to `dist/` and running `node dist/index.js`.
 */

const fs = require('fs');
const path = require('path');

function tryRequire(p) {
  try {
    return require(p);
  } catch (err) {
    // bubble up the error for the caller to reason about
    err.__reqPath = p;
    throw err;
  }
}

const baseDir = __dirname;
const distIndex = path.join(baseDir, 'dist', 'index.js');
const tsIndex = path.join(baseDir, 'src', 'index.ts');
const artifactPublisherShim = path.join(baseDir, '..', '..', 'artifact-publisher', 'server', 'dist', 'index.js');

console.log('[repowriter] bootstrapping RepoWriter server');

if (fs.existsSync(distIndex)) {
  console.log('[repowriter] Found compiled build at ./dist/index.js — running compiled server.');
  module.exports = tryRequire(distIndex);
  return;
}

if (fs.existsSync(tsIndex)) {
  // Try to use ts-node to run the TS source directly for dev convenience.
  try {
    // Prefer transpile-only register for faster startup in dev.
    // Attempt both ESM and CommonJS registrations that are commonly available.
    try {
      // ts-node's commonjs register
      require('ts-node/register/transpile-only');
      console.log('[repowriter] Loaded ts-node/register (transpile-only). Running ./src/index.ts');
      module.exports = tryRequire(tsIndex);
      return;
    } catch (e1) {
      // Try ts-node/esm loader fallback (rare in require context)
      try {
        require('ts-node').register?.({ transpileOnly: true });
        console.log('[repowriter] Loaded ts-node.register. Running ./src/index.ts');
        module.exports = tryRequire(tsIndex);
        return;
      } catch (e2) {
        console.warn('[repowriter] ts-node not available or failed to register. Attempting direct import of TS may fail.');
      }
    }
  } catch (err) {
    console.warn('[repowriter] Error while trying to load ts-node:', err && err.message ? err.message : err);
  }
}

// If reached here, we could not run local src or dist.
// As a last-resort compatibility, fall back to artifact-publisher if it exists (preserves old behavior).
if (fs.existsSync(artifactPublisherShim)) {
  console.warn(
    '[repowriter] Warning: Falling back to artifact-publisher server at ../../artifact-publisher/server/dist/index.js\n' +
      'You should migrate to the canonical RepoWriter server (compile to dist/ or install ts-node for dev).'
  );
  module.exports = tryRequire(artifactPublisherShim);
  return;
}

// Nothing worked — emit helpful error and exit.
const msg =
  '[repowriter] Fatal: cannot find a runnable server.\n' +
  'Expected one of:\n' +
  `  - ${distIndex} (compiled JavaScript)\n` +
  `  - ${tsIndex} (TypeScript source + ts-node available)\n` +
  `  - ${artifactPublisherShim} (compat artifact-publisher fallback)\n\n` +
  'Fix: build the project (npm --prefix RepoWriter/server run build) or install ts-node for dev (npm --prefix RepoWriter/server i -D ts-node),\n' +
  'or restore/point the artifact-publisher fallback if you intentionally want that behavior.';

console.error(msg);
throw new Error(msg);

