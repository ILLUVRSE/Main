/**
 * localllm.ts
 *
 * Server-side adapter to proxy requests to a LOCAL_LLM_URL.
 *
 * Defensive and now performs server-side prompt sanitization before forwarding.
 */

import fetch from "node-fetch";
import { sanitizePrompt } from "./promptSanitizer.js";

const LOCAL_LLM_URL = (process.env.LOCAL_LLM_URL || "").replace(/\/$/, "");

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Try OpenAI-like POST /v1/chat/completions (non-stream) */
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
  const json = safeJsonParse(text);
  if (json && (json.choices || json.results)) return json;
  // Fallback: wrap plain text into choices.message.content
  return { choices: [{ message: { content: text } }] };
}

/** Try text-generation-webui POST /generate */
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
    if (typeof (json as any).text === "string") return { choices: [{ message: { content: (json as any).text } }] };
    if (Array.isArray((json as any).results) && (json as any).results[0] && typeof (json as any).results[0].text === "string") {
      return { choices: [{ message: { content: (json as any).results[0].text } }] };
    }
  }
  return { choices: [{ message: { content: text } }] };
}

/** Public synchronous plan generator */
export async function generateLocalPlan(prompt: string) {
  // Sanitize incoming user prompt before doing anything
  try {
    sanitizePrompt(prompt);
  } catch (err: any) {
    // Surface a clear error to caller
    throw new Error(`Prompt rejected by sanitizer: ${String(err?.message || err)}`);
  }

  const system = [
    "You are RepoWriter's planning agent. Produce a structured plan as JSON only.",
    "JSON schema: { steps: [ { explanation: string, patches: [ { path: string, content?: string, diff?: string } ] } ] }",
    "Return only JSON fragments or text that can be combined into JSON. If streaming partial text, ensure final output is valid JSON."
  ].join("\n");

  const userPayload = JSON.stringify({ prompt, memory: [], guidance: "Return a structured plan in the JSON schema described in the system prompt." });

  try {
    const r = await callOpenAICompatibleOnce(system, userPayload);
    const choice = (r as any)?.choices?.[0] ?? {};
    const content = (choice && ((choice as any).message?.content ?? (choice as any).text)) ?? (typeof r === "string" ? r : null);
    if (typeof content === "string") {
      const maybe = safeJsonParse(content);
      if (maybe) return maybe;
      return { raw: content };
    }
    return r;
  } catch (err) {
    // fallback to webui-style
    try {
      const r2 = await callTextGenerationWebuiOnce(`${system}\n\n${userPayload}`);
      const choice = (r2 as any)?.choices?.[0] ?? {};
      const content = (choice && ((choice as any).message?.content ?? (choice as any).text)) ?? (typeof r2 === "string" ? r2 : null);
      if (typeof content === "string") {
        const maybe = safeJsonParse(content);
        if (maybe) return maybe;
        return { raw: content };
      }
      return r2;
    } catch (err2) {
      throw new Error(`Local LLM failed: ${String((err as any)?.message ?? err)} ; fallback failed: ${String((err2 as any)?.message ?? err2)}`);
    }
  }
}

/**
 * streamLocalPlan(system, user)
 *
 * Async generator that yields { raw: string } fragments.
 * Defensive about stream shapes: tries getReader() if present, otherwise
 * consumes Node stream as async iterator.
 */
export async function* streamLocalPlan(system: string, user: string) {
  if (!LOCAL_LLM_URL) throw new Error("LOCAL_LLM_URL not configured");

  // Attempt to extract and sanitize the user prompt (user may be a JSON string)
  try {
    let userPrompt: string | null = null;
    try {
      const parsed = JSON.parse(user);
      if (parsed && typeof parsed === "object" && typeof parsed.prompt === "string") {
        userPrompt = parsed.prompt;
      }
    } catch {
      // not JSON, treat whole user string as prompt
      userPrompt = user;
    }
    if (userPrompt) sanitizePrompt(userPrompt);
  } catch (err: any) {
    throw new Error(`Prompt rejected by sanitizer: ${String(err?.message || err)}`);
  }

  // Try OpenAI-like SSE streaming endpoint first
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

    // Prefer DOM-style getReader if available (node-fetch may not provide it)
    const bodyAny: any = res.body as any;
    if (bodyAny && typeof bodyAny.getReader === "function") {
      const reader: any = bodyAny.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          // SSE-style events separated by double newline
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const ev = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const lines = ev.split("\n").map((l: any) => l.trim()).filter(Boolean);
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
            const lines = buf.split("\n").map((l: any) => l.trim()).filter(Boolean);
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
          const lines = buf.split("\n").map((l: any) => l.trim()).filter(Boolean);
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
        try { reader.releaseLock?.(); } catch {}
      }
      return;
    }

    // Fallback: consume Node stream as async iterator
    const decoder = new TextDecoder();
    for await (const chunk of (res.body as any)) {
      const t = typeof chunk === "string" ? chunk : decoder.decode(chunk);
      yield { raw: t };
    }
    return;
  } catch (err) {
    // Fallback stream endpoint (webui/TGI)
    try {
      const url2 = `${LOCAL_LLM_URL.replace(/\/$/, "")}/api/generate`;
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
        const txt = await res2.text(); yield { raw: txt }; return;
      }

      const bodyAny2: any = res2.body as any;
      if (bodyAny2 && typeof bodyAny2.getReader === "function") {
        const reader2: any = bodyAny2.getReader();
        const decoder2 = new TextDecoder();
        let buf2 = "";
        try {
          while (true) {
            const { value, done } = await reader2.read();
            if (done) break;
            buf2 += decoder2.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf2.indexOf("\n\n")) !== -1) {
              const part = buf2.slice(0, idx);
              buf2 = buf2.slice(idx + 2);
              yield { raw: part };
            }
            if (buf2.length > 16000) {
              yield { raw: buf2.slice(0, 16000) };
              buf2 = buf2.slice(16000);
            }
          }
          if (buf2.trim()) yield { raw: buf2 };
        } finally {
          try { reader2.releaseLock?.(); } catch {}
        }
        return;
      }

      for await (const c of (res2.body as any)) {
        const t = typeof c === "string" ? c : new TextDecoder().decode(c);
        yield { raw: t };
      }
      return;
    } catch (err2) {
      throw new Error(`Local LLM streaming failed: ${String((err as any)?.message ?? err)} ; fallback failed: ${String((err2 as any)?.message ?? err2)}`);
    }
  }
}

export default { generateLocalPlan, streamLocalPlan };

