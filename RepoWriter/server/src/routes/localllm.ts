/**
 * localllm.ts (routes)
 *
 * Simple Express routes to proxy requests to a configured LOCAL_LLM_URL via
 * the server-side localllm service.
 *
 * Endpoints:
 *  - POST /api/llm/local/plan    { prompt }  -> returns JSON (plan or { raw: ... })
 *  - POST /api/llm/local/stream  { prompt }  -> SSE streaming of raw chunks
 *  - GET  /api/llm/local/health              -> { ok: true } when LOCAL_LLM_URL is configured
 */

import { Router } from "express";
import localllm from "../services/localllm.js";

const r = Router();

/** POST /api/llm/local/plan */
r.post("/plan", async (req, res, next) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ ok: false, error: "missing prompt" });
    }

    // Delegate to service; service returns parsed JSON or { raw: "..." } fallback
    try {
      const result = await localllm.generateLocalPlan(prompt);
      // Return as { plan: result } to mimic openai plan shape (planner may accept either)
      return res.json(result);
    } catch (err: any) {
      // Return informative error
      return res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/llm/local/stream
 *
 * Body: { prompt: string }
 * Returns SSE stream of `data: ...` events (payloads are raw strings from the local LLM).
 */
r.post("/stream", async (req, res, next) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ ok: false, error: "missing prompt" });
    }

    // Build a system/user pair similar to planner conventions
    const system = [
      "You are RepoWriter's planning agent. Produce a structured plan as JSON only.",
      "JSON schema: { steps: [ { explanation: string, patches: [ { path: string, content?: string, diff?: string } ] } ] }",
      "Return only JSON fragments or text that can be combined into JSON. If streaming partial text, ensure final output is valid JSON."
    ].join("\n");

    const user = JSON.stringify({
      prompt,
      memory: [],
      guidance: "Stream a structured JSON plan as you generate it."
    });

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // Stream generator from service yields { raw } chunks
    const iterator = localllm.streamLocalPlan(system, user);

    (async () => {
      try {
        for await (const chunk of iterator) {
          // chunk is { raw: "..." } — send as data: <escaped>
          const payload = String(chunk.raw).replace(/\n/g, "\\n");
          res.write(`data: ${payload}\n\n`);
        }
        // signal done
        res.write(`data: [DONE]\n\n`);
        res.end();
      } catch (err: any) {
        const msg = String(err?.message || err);
        res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
        try { res.end(); } catch {}
      }
    })();

  } catch (e) {
    next(e);
  }
});

/** Health */
r.get("/health", (_req, res) => {
  if (!process.env.LOCAL_LLM_URL) {
    return res.status(503).json({ ok: false, error: "LOCAL_LLM_URL not configured" });
  }
  return res.json({ ok: true, url: process.env.LOCAL_LLM_URL });
});

export default r;

