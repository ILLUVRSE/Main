// RepoWriter/server/src/routes/openaiRoutes.ts
//
// Minimal OpenAI / apply router for RepoWriter.
//
// - POST /api/openai/plan   -> proxies to OpenAI client and returns a structured plan
// - POST /api/openai/apply  -> supports { patches: [], mode: "dry"|"apply" }
//                             uses allowlistEnforcer middleware, returns rollback metadata
// - POST /api/openai/stream -> (not implemented / placeholder)

import express from "express";
import { chatJson } from "../services/openaiClient";
import allowlistEnforcer from "../middleware/allowlistEnforcer";
import path from "path";
import fs from "fs/promises";
import { commitPatches } from "../services/github";

const router = express.Router();
const REPO_ROOT = process.env.REPO_PATH || process.cwd();

/**
 * POST /api/openai/plan
 * Body: { prompt, memory? }
 * Returns: { plan: ... } (whatever OpenAI returns / chatJson parses)
 */
router.post("/plan", async (req, res, next) => {
  try {
    const prompt = req.body?.prompt || "";
    // Small system prompt so the model returns a structured plan when used with real OpenAI.
    const system = "You are a repo assistant. Return a JSON object `plan` with steps and patches.";
    const result = await chatJson(system, prompt);
    return res.json({ plan: result });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/openai/apply
 * Body: { patches: [{path, content?, diff?}], mode: 'dry' | 'apply', message? }
 *
 * - allowlistEnforcer() runs first to reject forbidden/not-allowed paths.
 * - If mode === 'dry' -> return validation + rollback metadata (previousContents) without changing disk.
 * - If mode === 'apply' -> write patches to REPO_PATH, commit using commitPatches(), and return rollback metadata.
 */
router.post("/apply", allowlistEnforcer(), async (req, res, next) => {
  try {
    const patches = Array.isArray(req.body?.patches) ? req.body.patches : [];
    const mode = (req.body?.mode || "apply").toLowerCase();
    if (!Array.isArray(patches)) {
      return res.status(400).json({ ok: false, error: "invalid_patches" });
    }

    // Build rollback metadata: previous contents for each patch path
    const previousContents: { path: string; content?: string | null }[] = [];
    for (const p of patches) {
      const rel = p.path;
      if (!rel || typeof rel !== "string") continue;
      const abs = path.resolve(REPO_ROOT, rel);
      try {
        const cur = await fs.readFile(abs, "utf8");
        previousContents.push({ path: rel, content: cur });
      } catch (e: any) {
        // if not found, record null (meaning file didn't exist before)
        previousContents.push({ path: rel, content: null });
      }
    }

    if (mode === "dry") {
      return res.json({ ok: true, mode: "dry", validated: true, rollback: previousContents });
    }

    // mode === "apply": write files, then commit
    for (const p of patches) {
      const rel = p.path;
      if (!rel || typeof rel !== "string") continue;
      const abs = path.resolve(REPO_ROOT, rel);
      // ensure parent dir exists
      await fs.mkdir(path.dirname(abs), { recursive: true });
      if (p.content === null) {
        // delete
        try {
          await fs.unlink(abs);
        } catch (e) {
          /* ignore */
        }
      } else if (typeof p.content === "string") {
        await fs.writeFile(abs, p.content, "utf8");
      }
    }

    // Commit the changes; commitPatches will re-check allowlist and emit audit
    const commitMessage = req.body?.message || "repowriter: apply";
    const commitRes = await commitPatches(patches, commitMessage);

    return res.json({ ok: true, mode: "apply", commit: commitRes, rollback: previousContents });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/openai/stream
 * Streaming / SSE is not implemented in this minimal route. Return 501 for now.
 */
router.post("/stream", (_req, res) => {
  res.status(501).json({ ok: false, error: "not_implemented" });
});

export default router;

