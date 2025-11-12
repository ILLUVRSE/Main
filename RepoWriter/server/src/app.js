/**
 * app.js
 *
 * Express app for RepoWriter. Mounts:
 *  - /api/openai -> codex routes (planner/stream/apply/validate)
 *  - /api/repo -> repo routes (list/file/branch-commit/push/pr)
 *  - /api/llm/local  -> local LLM proxy (if implemented)
 *
 * Also provides /api/health and basic error handling.
 */

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import morgan from "morgan";

import ensureOpenAIKey from "./middleware/ensureOpenAIKey.js";
import codexRoutes from "./routes/codex.js";
import repoRoutes from "./routes/repo.js";
// local LLM routes (mounted if file exists)
let localllmRoutes = null;
try {
  // optional — will throw if file absent; we handle gracefully
  // eslint-disable-next-line import/no-unresolved
  // dynamic import to avoid startup failure if not present
  // Note: require is not used to keep ESM style consistent
  // but we can attempt a dynamic import synchronously earlier; for simplicity, require-like fallback:
  // Use try/catch around import
} catch {}

/**
 * Try to import localllm routes. This is a soft dependency: if it doesn't exist
 * or LOCAL_LLM_URL isn't configured, the route simply won't be mounted.
 */
(async () => {
  try {
    // eslint-disable-next-line import/no-relative-parent-imports
    const mod = await import("./routes/localllm.js");
    localllmRoutes = mod.default || mod;
  } catch {
    // ignore if not present
    localllmRoutes = null;
  }
})();

const app = express();

// Basic middleware
app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));
app.use(bodyParser.urlencoded({ extended: true }));
// Simple request logging in dev; in production you may want to route this differently.
app.use(morgan(process.env.LOG_FORMAT || "dev"));

// Health endpoint
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Attach routes. For endpoints that call OpenAI, attach ensureOpenAIKey to protect accidental calls.
app.use("/api/openai", ensureOpenAIKey, codexRoutes);

// Repo operations (list/file/branch/PR) do not require OpenAI, so mount without ensureOpenAIKey
app.use("/api/repo", repoRoutes);

// Mount local LLM proxy routes if available. We mount them eagerly if the module was loaded.
// If the module was not found or LOCAL_LLM_URL isn't configured, the module's health endpoint will indicate that.
if (localllmRoutes) {
  app.use("/api/llm/local", localllmRoutes);
  // eslint-disable-next-line no-console
  console.log("[app] mounted /api/llm/local routes (localllm.js present)");
} else {
  // eslint-disable-next-line no-console
  console.log("[app] local LLM routes not mounted (localllm.js not present)");
}

// Basic 404
app.use((req, res, _next) => {
  res.status(404).json({ ok: false, error: "not found" });
});

// Error handler
app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error("[app error]", err && (err.stack || err.message || err));
  const status = err && err.status ? err.status : 500;
  const message = err && err.message ? String(err.message) : "internal server error";
  res.status(status).json({ ok: false, error: message });
});

export default app;

