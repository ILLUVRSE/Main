/**
 * openaiStreamClient.ts (updated)
 *
 * Robust streaming client that yields raw payload strings and an optional parsed value.
 *
 * Each yielded value is either:
 *   { raw: "...payload string..." }
 * or
 *   { raw: "...", parsed: <JSON or extracted fragment> }
 *
 * Callers should prefer `parsed` when present but may use `raw` for diagnostics.
 */

import { getOpenAIHeaders } from "../config.js";

export type StreamChunk = {
  raw: string;
  parsed?: any;
};

/** Helper: attempt to parse a payload string into a useful parsed object.
 * Handles OpenAI SSE payloads and other common shapes.
 */
function tryParsePayload(payload: string): any | undefined {
  if (!payload || typeof payload !== "string") return undefined;
  const trimmed = payload.trim();

  // If payload looks like JSON, try to parse
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed);
      // Extract common shapes: choices[].delta.content (streaming), choices[].message.content, choices[].text
      const choice = json?.choices?.[0];
      if (choice) {
        // streaming delta style
        if (choice.delta) {
          // If delta contains structured fields, return delta as parsed
          return { kind: "delta", delta: choice.delta, rawJson: json };
        }
        // message content style
        if (choice.message && choice.message.content) {
          return { kind: "message", content: choice.message.content, rawJson: json };
        }
        // text fallback
        if (choice.text) {
          return { kind: "text", text: choice.text, rawJson: json };
        }
      }
      // If no choices, return parsed JSON
      return json;
    } catch {
      // ignore parse error and continue to heuristics
    }
  }

  // Payload may contain JSON embedded in text. Try to find first JSON object substring.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const cand = trimmed.slice(first, last + 1);
    try {
      const json = JSON.parse(cand);
      return json;
    } catch {
      // no-op
    }
  }

  // If payload is plain text, return undefined (caller will use raw)
  return undefined;
}

/**
 * streamChat
 *
 * Create a streaming chat completion async generator.
 * Each yielded value is StreamChunk { raw, parsed? }.
 */
export async function* streamChat(system: string, user: string, model = "gpt-4o-mini"): AsyncGenerator<StreamChunk, void, unknown> {
  const headers = getOpenAIHeaders();

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    stream: true
  };

  const OPENAI_BASE = process.env.OPENAI_API_URL || "https://api.openai.com";
  const res = await fetch(`${OPENAI_BASE}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${txt}`);
  }

  // If there's no streaming body, treat response as one-off
  if (!res.body) {
    const txt = await res.text();
    const parsed = tryParsePayload(txt);
    yield { raw: txt, parsed };
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

      // SSE-style: events separated by double-newline
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const rawEvent = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        // Each event may contain multiple lines like "data: ..." or other fields
        const lines = rawEvent.split("\n").map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === "[DONE]") {
              return;
            }
            // Attempt to parse payload into structured parsed result
            let parsed;
            try {
              parsed = tryParsePayload(payload);
            } catch {
              parsed = undefined;
            }
            yield { raw: payload, parsed };
          } else {
            // Non-data SSE lines: yield raw for diagnostics
            yield { raw: line };
          }
        }
      }

      // newline-terminated single-line events (defensive)
      if (buf.endsWith("\n")) {
        const lines = buf.split("\n").map(l => l.trim()).filter(Boolean);
        buf = "";
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === "[DONE]") return;
            let parsed;
            try { parsed = tryParsePayload(payload); } catch { parsed = undefined; }
            yield { raw: payload, parsed };
          } else {
            yield { raw: line };
          }
        }
      }
    }

    // Trailing buffer processing (if any)
    if (buf.trim()) {
      const lines = buf.split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === "[DONE]") return;
          let parsed;
          try { parsed = tryParsePayload(payload); } catch { parsed = undefined; }
          yield { raw: payload, parsed };
        } else {
          yield { raw: line };
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

export default { streamChat };

