import { Router } from "express";
import { streamChat } from "../services/openaiStreamClient.js";
import { planEdits } from "../services/planner.js";
import { applyPatches } from "../services/patcher.js";

const r = Router();

/**
 * POST /api/openai/stream
 * Body: { prompt: string, memory?: string[] }
 *
 * Streams model payloads as SSE (Server-Sent Events). Each `data:` event contains
 * the raw JSON payload emitted by OpenAI streaming responses (or the textual chunk).
 */
r.post("/stream", async (req, res, next) => {
  try {
    const { prompt, memory = [] } = req.body as { prompt: string; memory?: string[] };
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "missing prompt" });
    }

    // Build a lightweight system/user pair similar to planner
    const system = [
      "You are RepoWriter's planning agent. Produce a structured plan as JSON only.",
      "JSON schema: { steps: [ { explanation: string, patches: [ { path: string, content?: string, diff?: string } ] } ] }",
      "Return only JSON fragments or text that can be combined into JSON. If streaming partial text, ensure final output is valid JSON."
    ].join("\n");

    const user = JSON.stringify({
      prompt,
      memory,
      guidance: "Stream a structured JSON plan as you generate it."
    });

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // streamChat yields { raw } where raw is a string payload (usually JSON or JSON fragments)
    const iterator = streamChat(system, user);
    (async () => {
      try {
        for await (const chunk of iterator) {
          // Send each raw payload as an SSE `data:` event
          const safe = String(chunk.raw).replace(/\n/g, "\\n");
          res.write(`data: ${safe}\n\n`);
        }
        // Signal done
        res.write(`data: [DONE]\n\n`);
        res.end();
      } catch (err: any) {
        const msg = String(err?.message || err);
        res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
        res.end();
      }
    })();

  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/openai/plan
 * Body: { prompt: string, memory?: string[] }
 *
 * Returns a structured Plan object (non-streaming).
 */
r.post("/plan", async (req, res, next) => {
  try {
    const { prompt, memory = [] } = req.body as { prompt: string; memory?: string[] };
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "missing prompt" });
    }
    const plan = await planEdits(prompt, memory || []);
    res.json({ plan });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/openai/apply
 * Body: { patches: Array<{path,content?,diff?}>, mode?: "dry"|"apply" }
 *
 * Applies patches via patcher.applyPatches and returns structured result including
 * rollback metadata on successful apply.
 */
r.post("/apply", async (req, res, next) => {
  try {
    const { patches, mode = "apply" } = req.body as { patches: Array<any>; mode?: "dry" | "apply" };
    if (!Array.isArray(patches)) {
      return res.status(400).json({ error: "missing or invalid patches array" });
    }

    const result = await applyPatches(patches, mode === "dry" ? "dry" : "apply");
    res.json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/openai/validate
 * Body: { patches: Array<{path,content?,diff?}> }
 *
 * Optional: run sandbox validation (tests/quick checks). If no sandbox runner is
 * installed, return 501 Not Implemented.
 */
r.post("/validate", async (req, res, next) => {
  try {
    // For now, we do not include a sandbox runner in this iteration.
    // This endpoint intentionally returns 501 until sandboxRunner is implemented.
    return res.status(501).json({ ok: false, error: "validate not implemented; add sandboxRunner to enable" });
  } catch (e) {
    next(e);
  }
});

export default r;

