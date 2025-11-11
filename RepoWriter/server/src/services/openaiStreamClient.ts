/**
 * openaiStreamClient.ts
 *
 * Minimal OpenAI streaming client that returns an async generator of string chunks.
 * It uses the standard SSE-style streaming format that OpenAI chat/completions emits:
 *
 *   data: {...json...}
 *   data: {...json...}
 *   data: [DONE]
 *
 * Each yielded value is the raw JSON `data` payload (string). Callers can parse it
 * or simply concatenate `delta` text pieces into a final response.
 *
 * Note: This intentionally yields raw payload strings to avoid assumptions about the
 * exact streaming schema; planner code can interpret the streamed JSON as needed.
 */

import { getOpenAIHeaders } from "../config.js";

export type StreamChunk = {
  raw: string;
};

/** Create a streaming chat completion generator */
export async function* streamChat(system: string, user: string, model = "gpt-4o-mini"): AsyncGenerator<StreamChunk, void, unknown> {
  const headers = getOpenAIHeaders();

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    stream: true,
    // do not set response_format here; streaming payloads vary by model/format
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${txt}`);
  }

  if (!res.body) {
    // No streaming body available, return
    const txt = await res.text();
    // yield as one-off
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

      // Split events by double-newline which separates SSE events
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const rawEvent = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        // Each event may contain multiple lines starting with "data: "
        const lines = rawEvent.split("\n").map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            return;
          }
          // yield raw payload; caller decides how to interpret JSON or text
          yield { raw: payload };
        }
      }

      // To avoid unbounded buffer growth, attempt to process single-line events if they end with newline
      if (buf.endsWith("\n")) {
        const lines = buf.split("\n").map(l => l.trim()).filter(Boolean);
        buf = "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            return;
          }
          yield { raw: payload };
        }
      }
    }

    // process any remaining buffer
    if (buf.trim()) {
      const lines = buf.split("\n").map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          return;
        }
        yield { raw: payload };
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

export default { streamChat };

