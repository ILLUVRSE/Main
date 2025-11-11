/**
 * kernel/src/server.ts
 *
 * Shim / re-export for the runtime server implementation which is emitted under
 * kernel/dist/server.js. The original file had an invalid export with
 * `createAppSync as app` in an object literal which TypeScript rejects.
 *
 * This file re-exports the runtime functions and provides a valid default
 * export shape: { start, createApp, createAppSync, app: createAppSync }.
 *
 * Keeping the runtime implementation in `dist` avoids duplicating logic and
 * ensures tests continue to exercise the same code path the test run uses.
 *
 * NOTE: This file intentionally uses CommonJS `require` to import the already-
 * emitted JS in dist. That keeps the behavior identical and keeps TypeScript
 * happy when compiling the project.
 */

const impl: any = require('../dist/server');

// export named symbols for other parts of the codebase that import them
export const start: any = impl.start;
export const createApp: any = impl.createApp;
export const createAppSync: any = impl.createAppSync;

// Expose `app` as a named export (alias to createAppSync if not directly available)
export const app: any = impl.app ?? impl.createAppSync;

// Provide a valid default export object with a property `app: createAppSync`
export default {
  start,
  createApp,
  createAppSync,
  app: createAppSync,
};

