/**
 * localllm.ts
 *
 * Lightweight server-side adapter to proxy requests to a LOCAL_LLM_URL.
 *
 * Exports:
 *  - generateLocalPlan(prompt: string): Promise<any>
 *  - streamLocalPlan(system: string, user: string): AsyncGenerator<{ raw: string }>
 *
 * Behavior:
 *  - Detects common endpoints:
 *      - OpenAI-like POST /v1/chat/completions (chat format)
 *      - text-generation-webui POST /generate (simple {text} or {results:[{text}]})
 *  - For streaming, supports SSE or chunked text returned by the backend.
 */

import fetch from "node-fetch";

const LOCAL_LLM_URL = (process.env.LOCAL_LLM_URL || "").replace(/\/$/, "");

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Attempt to call an OpenAI-like /v1/chat/completions endpoint synchronously (non-stream) */
async function callOpenAICompatibleOnce(system: string, user: string, model = "gpt-4o-mini") {
  if (!LOCAL_LLM_URL) throw new Error("LOCAL_LLM_URL not configured");
  const url = `${LOCAL_LLM_URL.replace(/\/$/, "")}/v1/chat/completions`;
  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    stream: false
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Local LLM HTTP ${res.status}: ${text}`);
  }
  // The local adapter may return OpenAI-like JSON or plain text.
  const json = safeJsonParse(text);
  if (json && (json.choices || json.results)) {
    return json;
  }
  // If plain text, return { choices: [{ message: { content: text } }] }
  return { choices: [{ message: { content: text } }] };
}

/** Attempt text-generation-webui style /generate */
async function callTextGenerationWebuiOnce(prompt: string) {
  if (!LOCAL_LLM_URL) throw new Error("LOCAL_LLM_URL not configured");
  const url = `${LOCAL_LLM_URL.replace(/\/$/, "")}/generate`;
  const body = { prompt, max_new_tokens: 512, temperature: 0.2 };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Local LLM (webui) HTTP ${res.status}: ${text}`);
  }
  const json = safeJsonParse(text);
  if (json) {
    // webui may return {text: "..."} or {results: [{text:"..."}]}
    if (typeof json.text === "string") return { choices: [{ message: { content: json.text } }] };
    if (Array.isArray(json.results) && json.results[0] && typeof json.results[0].text === "string") {
      return { choices: [{ message: { content: json.results[0].text } }] };
    }
  }
  // fall back to text
  return { choices: [{ message: { content: text } }] };
}

/** Public: generateLocalPlan(prompt) -> normalized response */
export async function generateLocalPlan(prompt: string) {
  // Build a lightweight system prompt similar to planner
  const system = [
    "You are RepoWriter's planning agent. Produce a structured plan as JSON only.",
    "JSON schema: { steps: [ { explanation: string, patches: [ { path: string, content?: string, diff?: string } ] } ] }",
    "Return only JSON fragments or text that can be combined into JSON. If streaming partial text, ensure final output is valid JSON."
  ].join("\n");

  const userPayload = JSON.stringify({ prompt, memory: [], guidance: "Return a structured plan in the JSON schema described in the system prompt." });

  // Try OpenAI-like endpoint first
  try {
    const r = await callOpenAICompatibleOnce(system, userPayload);
    // If r is choices structure, extract content
    const content = r?.choices?.[0]?.message?.content ?? r?.choices?.[0]?.text ?? (typeof r === "string" ? r : null);
    if (typeof content === "string") {
      // attempt to parse JSON if content is JSON
      const maybe = safeJsonParse(content);
      if (maybe) return maybe;
      // otherwise return raw wrapper
      return { raw: content };
    }
    return r;
  } catch (err) {
    // fallback to text-generation-webui
    try {
      const r2 = await callTextGenerationWebuiOnce(`${system}\n\n${userPayload}`);
      const content = r2?.choices?.[0]?.message?.content ?? r2?.choices?.[0]?.text ?? (typeof r2 === "string" ? r2 : null);
      if (typeof content === "string") {
        const maybe = safeJsonParse(content);
        if (maybe) return maybe;
        return { raw: content };
      }
      return r2;
    } catch (err2) {
      throw new Error(`Local LLM failed: ${String(err?.message || err)} ; fallback failed: ${String(err2?.message || err2)}`);
    }
  }
}

/**
 * streamLocalPlan(system, user)
 *
 * Async generator that proxies streaming output from local LLM.
 * Yields objects { raw: string } similar to openaiStreamClient.streamChat.
 *
 * Supports:
 *  - OpenAI-style SSE (v1/chat/completions stream with data: lines)
 *  - text-generation-webui chunked responses (returns text/plain streaming)
 */
export async function* streamLocalPlan(system: string, user: string) {
  if (!LOCAL_LLM_URL) throw new Error("LOCAL_LLM_URL not configured");
  // Try OpenAI-compatible streaming endpoint
  try {
    const url = `${LOCAL_LLM_URL.replace(/\/$/, "")}/v1/chat/completions`;
    const body = { model: "gpt-4o-mini", temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: user }], stream: true };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Local LLM stream HTTP ${res.status}: ${txt}`);
    }
    if (!res.body) {
      const txt = await res.text();
      yield { raw: txt };
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE style: split by double newline
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const ev = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const lines = ev.split("\n").map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            if (line.startsWith("data:")) {
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") return;
              yield { raw: payload };
            } else {
              yield { raw: line };
            }
          }
        }

        // newline-terminated fallback
        if (buf.endsWith("\n")) {
          const lines = buf.split("\n").map(l => l.trim()).filter(Boolean);
          buf = "";
          for (const line of lines) {
            if (line.startsWith("data:")) {
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") return;
              yield { raw: payload };
            } else {
              yield { raw: line };
            }
          }
        }
      }

      // trailing buffer
      if (buf.trim()) {
        const lines = buf.split("\n").map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") return;
            yield { raw: payload };
          } else {
            yield { raw: line };
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    return;
  } catch (err) {
    // If openai-like streaming failed, try TGI/webui fallback: POST /generate with chunking
    try {
      const url2 = `${LOCAL_LLM_URL.replace(/\/$/, "")}/api/generate`; // some webuis expose this
      const body2 = { prompt: `${system}\n\n${user}`, max_new_tokens: 512, temperature: 0.2, stream: true };
      const res2 = await fetch(url2, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body2)
      });
      if (!res2.ok) {
        const txt = await res2.text();
        throw new Error(`Local LLM fallback stream HTTP ${res2.status}: ${txt}`);
      }
      if (!res2.body) {
        const txt = await res2.text();
        yield { raw: txt };
        return;
      }
      const reader = res2.body.getReader();
      const decoder = new TextDecoder();
      let buf2 = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf2 += decoder.decode(value, { stream: true });
          // chunked plain text: yield incremental decoded text
          // Attempt to split at double-newline for readability
          let idx;
          while ((idx = buf2.indexOf("\n\n")) !== -1) {
            const part = buf2.slice(0, idx);
            buf2 = buf2.slice(idx + 2);
            yield { raw: part };
          }
          // If buffer grows huge, flush a portion
          if (buf2.length > 16_000) {
            yield { raw: buf2.slice(0, 16000) };
            buf2 = buf2.slice(16000);
          }
        }
        if (buf2.trim()) yield { raw: buf2 };
      } finally {
        try { reader.releaseLock(); } catch {}
      }
      return;
    } catch (err2) {
      throw new Error(`Local LLM streaming failed: ${String(err)} ; fallback failed: ${String(err2)}`);
    }
  }
}

export default { generateLocalPlan, streamLocalPlan };

