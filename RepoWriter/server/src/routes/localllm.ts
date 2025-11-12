/**
 * localllm.ts
 *
 * Simple local-LLM proxy and planner helper.
 *
 * Exposes:
 *  - POST /api/llm/local/generate   -> { text: string } (synchronous generation)
 *  - POST /api/llm/local/plan       -> { plan: Plan } (tries to parse/normalize JSON plan)
 *  - POST /api/llm/local/stream     -> proxied streaming endpoint (SSE or chunked)
 *
 * Configuration:
 *  - LOCAL_LLM_URL env var (default: http://127.0.0.1:7860)
 *
 * Notes:
 *  - This file is intentionally defensive: many local LLM servers have different endpoints.
 *    The implementation tries a few common endpoints and payload shapes:
 *      /v1/chat/completions  (OpenAI-compatible)
 *      /generate, /api/generate, /v1/generate (text-generation-webui style)
 *  - For streaming we forward headers/body from upstream to the client (best-effort).
 */

import { Router, Request, Response, NextFunction } from "express";

const router = Router();

const DEFAULT_LOCAL = "http://127.0.0.1:7860";

function getBaseUrl() {
  return process.env.LOCAL_LLM_URL || DEFAULT_LOCAL;
}

async function tryFetchJson(url: string, body: any, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    // allow slower local LLMs
  });
  const text = await res.text();
  let json: any | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, text, json };
}

/** Try a few candidate endpoints/payloads to get textual output from a local LLM server */
async function queryLocalLlmForText(prompt: string, opts: { max_tokens?: number; temperature?: number; model?: string } = {}) {
  const base = getBaseUrl();

  // Candidate 1: OpenAI-like chat completions (if the local adapter supports it)
  try {
    const url = `${base.replace(/\/$/, "")}/v1/chat/completions`;
    const body = {
      model: opts.model ?? "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.max_tokens ?? 512
    };
    const { res, text, json } = await tryFetchJson(url, body);
    if (res.ok) {
      // Try to extract text from common shapes
      const content =
        json?.choices?.[0]?.message?.content ??
        json?.choices?.[0]?.text ??
        json?.output ??
        json?.text ??
        text;
      return { text: String(content) };
    }
  } catch (err) {
    // ignore and try next
  }

  // Candidate 2: text-generation-webui style /generate
  const tryPaths = ["/generate", "/api/generate", "/v1/generate"];
  for (const p of tryPaths) {
    try {
      const url = `${base.replace(/\/$/, "")}${p}`;
      const body = {
        prompt,
        max_new_tokens: opts.max_tokens ?? 512,
        temperature: opts.temperature ?? 0.2,
        model: opts.model
      };
      const { res, text, json } = await tryFetchJson(url, body);
      if (res.ok) {
        // Many webuis return { text } or { results: [{ text }] }
        const content = json?.text ?? json?.output ?? json?.results?.[0]?.text ?? text;
        return { text: String(content) };
      }
    } catch (err) {
      // ignore and continue
    }
  }

  // Candidate 3: fallback GET to base for quick check
  try {
    const check = await fetch(base);
    if (check.ok) {
      const txt = await check.text();
      return { text: txt };
    }
  } catch {
    // ignore
  }

  throw new Error("Local LLM: unable to contact local LLM server (tried multiple endpoints). Set LOCAL_LLM_URL or run a local LLM.");
}

/** Helper: try to parse a JSON plan from text, with basic heuristics */
function extractJsonFromText(text: string): any {
  // Quick attempt: parse full text
  try {
    return JSON.parse(text);
  } catch {
    // Try to locate first { ... } block
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = text.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        // fallthrough
      }
    }
    // Try to find a JSON array root (for steps)
    const firstBracket = text.indexOf("[");
    const lastBracket = text.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      const cand = text.slice(firstBracket, lastBracket + 1);
      try {
        return JSON.parse(cand);
      } catch {
        // fallthrough
      }
    }
    return null;
  }
}

/** POST /api/llm/local/generate */
router.post("/generate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prompt, max_tokens, temperature, model } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "missing prompt" });
    }

    const out = await queryLocalLlmForText(prompt, { max_tokens, temperature, model });
    // Normalize
    return res.json({ text: out.text });
  } catch (err: any) {
    return next(err);
  }
});

/**
 * POST /api/llm/local/plan
 * Attempt to generate a structured plan from the prompt using the local LLM.
 * The local LLM should produce JSON. We do our best to parse it into { plan }.
 */
router.post("/plan", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prompt, max_tokens, temperature, model } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "missing prompt" });
    }

    // Wrap the prompt with instructions to return a JSON Plan
    const systemPrefix = `You are RepoWriter's planning agent. Produce a single JSON object that matches this schema:\n\n{
  "steps": [
    {
      "explanation": "<string>",
      "patches": [
        { "path": "<string>", "content?: \"...\" or diff?: \"...\"" }
      ]
    }
  ]
}\n\nReturn only the JSON object or fragments that can be concatenated into valid JSON.`;
    const combinedPrompt = `${systemPrefix}\n\nUser prompt:\n${prompt}`;

    // Query local LLM
    const { text } = await queryLocalLlmForText(combinedPrompt, { max_tokens, temperature, model });

    // Try to parse JSON
    let parsed = extractJsonFromText(text);
    if (!parsed) {
      // If it failed, return the raw text with an error flag so client can show it
      return res.json({ plan: { steps: [{ explanation: `planner: model call returned unparsable output`, patches: [] }] }, meta: { error: true, raw: text } });
    }

    // Normalize: server may return { plan } or plan directly
    const plan = parsed.plan ?? parsed;
    return res.json({ plan, meta: {} });
  } catch (err: any) {
    return next(err);
  }
});

/**
 * POST /api/llm/local/stream
 * Proxy a streaming response from the local LLM to the browser.
 * This will copy most headers and stream body chunks directly.
 *
 * If the upstream responds with SSE, we forward SSE events as-is.
 * If upstream responds with chunked text, we forward chunks as they arrive.
 */
router.post("/stream", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prompt, max_tokens, temperature, model } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "missing prompt" });
    }

    const base = getBaseUrl();
    const candidate = `${base.replace(/\/$/, "")}/v1/chat/completions`; // prefer chat if available
    const bodyChat = {
      model: model ?? "gpt-4o-mini",
      temperature: temperature ?? 0.2,
      messages: [{ role: "system", content: "You are RepoWriter planning agent. Stream JSON plan fragments." }, { role: "user", content: prompt }],
      stream: true
    };

    // Try chat completions streaming first, then fallback to /generate streaming
    const endpoints = [
      { url: `${base.replace(/\/$/, "")}/v1/chat/completions`, body: bodyChat },
      { url: `${base.replace(/\/$/, "")}/generate`, body: { prompt, max_new_tokens: max_tokens ?? 512, temperature: temperature ?? 0.2 } },
      { url: `${base.replace(/\/$/, "")}/api/generate`, body: { prompt, max_new_tokens: max_tokens ?? 512, temperature: temperature ?? 0.2 } }
    ];

    let upstreamResponse: Response | null = null;
    let lastErr: any = null;
    for (const ep of endpoints) {
      try {
        const r = await fetch(ep.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ep.body),
        });
        if (!r.ok) {
          lastErr = new Error(`Upstream ${ep.url} returned ${r.status}`);
          continue;
        }
        upstreamResponse = r;
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!upstreamResponse) {
      return res.status(502).json({ error: `Local LLM streaming error: ${String(lastErr)}` });
    }

    // Copy relevant headers
    upstreamResponse.headers.forEach((value, key) => {
      // Avoid hop-by-hop headers
      if (["connection", "content-length", "transfer-encoding"].includes(key.toLowerCase())) return;
      res.setHeader(key, value);
    });

    // Ensure we tell client it's an event-stream if upstream doesn't
    if (!res.getHeader("content-type")) {
      res.setHeader("Content-Type", "text/event-stream");
    }
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // Stream body
    if (!upstreamResponse.body) {
      const txt = await upstreamResponse.text();
      res.write(txt);
      res.end();
      return;
    }

    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        // write chunk directly to client
        try {
          res.write(chunk);
        } catch {
          // client disconnected
          break;
        }
      }
    } catch (err) {
      // ignore read errors
    } finally {
      try { reader.cancel(); } catch {}
      try { res.write("\n"); } catch {}
      try { res.end(); } catch {}
    }
  } catch (err: any) {
    return next(err);
  }
});

export default router;

