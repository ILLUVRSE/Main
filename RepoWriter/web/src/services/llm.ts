/**
 * services/llm.ts
 *
 * Client helpers to talk to a local / proxied local-LLM service.
 *
 * Exports:
 *  - generateLocalPlan(prompt) -> Promise<Plan>
 *  - generateLocalText(prompt, opts) -> Promise<{ text: string }>
 *  - streamLocalGenerate(prompt, onChunk, onDone, onError) -> Promise<void>
 *
 * These functions call server endpoints under `/api/llm/local/*` (a small server-side proxy).
 * The frontend settings UI writes local LLM configuration to localStorage; the server proxy
 * is responsible for honoring that configuration. If you prefer calling the LLM directly
 * from the browser, adapt the endpoints to call the `LOCAL_LLM_URL` stored in settings.
 *
 * Note: streaming tries to be robust — it detects SSE-style `data:` events and falls back to
 * reading chunked text from the body reader.
 */

export type Plan = {
  steps: Array<{
    explanation: string;
    patches: Array<{ path: string; content?: string; diff?: string }>;
  }>;
  meta?: Record<string, any>;
};

type GenerateOpts = {
  max_tokens?: number;
  temperature?: number;
  model?: string;
};

function defaultHeaders() {
  return {
    "Content-Type": "application/json"
  };
}

/**
 * generateLocalPlan
 * - prompt: narrative instruction
 * - returns a normalized Plan object
 */
export async function generateLocalPlan(prompt: string): Promise<Plan> {
  if (!prompt || !prompt.trim()) throw new Error("prompt required");

  const body = {
    prompt,
    // Client may include more hints; the server/local planner can interpret them.
  };

  const res = await fetch("/api/llm/local/plan", {
    method: "POST",
    headers: defaultHeaders(),
    body: JSON.stringify(body)
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = `Local LLM plan error ${res.status}: ${text}`;
    try {
      const j = JSON.parse(text);
      msg = j?.error || j?.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  try {
    const j = JSON.parse(text);
    // server should return { plan } or the plan itself
    return (j.plan ?? j) as Plan;
  } catch (err) {
    throw new Error(`Failed to parse plan JSON: ${String(err?.message || err)}`);
  }
}

/**
 * generateLocalText
 * - simple synchronous generation (non-streaming)
 * - returns { text }
 */
export async function generateLocalText(prompt: string, opts: GenerateOpts = {}): Promise<{ text: string }> {
  if (!prompt || !prompt.trim()) throw new Error("prompt required");

  const payload = {
    prompt,
    ...opts
  };

  const res = await fetch("/api/llm/local/generate", {
    method: "POST",
    headers: defaultHeaders(),
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = `Local LLM error ${res.status}: ${text}`;
    try {
      const j = JSON.parse(text);
      msg = j?.error || j?.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  try {
    const j = JSON.parse(text);
    // Expect either { text } or { output: "..." }
    return { text: j.text ?? j.output ?? String(j) };
  } catch {
    // If not JSON, return raw text
    return { text };
  }
}

/**
 * streamLocalGenerate
 *
 * Calls /api/llm/local/stream which is expected to stream either:
 *  - SSE-style `data: ...` events (common), OR
 *  - plain chunked text (we will forward chunks to onChunk)
 *
 * onChunk receives string chunks (partial text)
 * onDone() is called when stream finished
 * onError(err) called on error
 */
export async function streamLocalGenerate(
  prompt: string,
  onChunk: (chunk: string) => void,
  onDone?: () => void,
  onError?: (err: Error) => void,
  opts: GenerateOpts = {}
): Promise<void> {
  if (!prompt || !prompt.trim()) {
    const err = new Error("prompt required");
    onError?.(err);
    throw err;
  }

  const payload = { prompt, ...opts };

  let res: Response;
  try {
    res = await fetch("/api/llm/local/stream", {
      method: "POST",
      headers: defaultHeaders(),
      body: JSON.stringify(payload)
    });
  } catch (err: any) {
    const e = new Error(`Network error: ${String(err?.message || err)}`);
    onError?.(e);
    throw e;
  }

  if (!res.ok) {
    const txt = await res.text();
    const e = new Error(`Local LLM stream error ${res.status}: ${txt}`);
    onError?.(e);
    throw e;
  }

  // If no body (rare), treat as not-streaming
  if (!res.body) {
    const txt = await res.text();
    onChunk(txt);
    onDone?.();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunkText = decoder.decode(value, { stream: true });
      buf += chunkText;

      // If the payload contains SSE-like events ("data: "), process them
      // Process any complete events separated by \n\n
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const rawEvent = buf.slice(0, idx);
        buf = buf.slice(idx + 2);

        // Each line could be like "data: {...}" or simple text
        const lines = rawEvent.split("\n").map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (line.startsWith("data:")) {
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") {
              onDone?.();
              return;
            }
            // Try to decode JSON payload else forward raw
            try {
              const parsed = JSON.parse(payload);
              // If parsed is object with text or choices, extract readable text
              if (typeof parsed === "object" && parsed !== null) {
                // common shapes: { text }, { output }, { choices: [{text}|{message:{content}}] }
                const text =
                  parsed.text ??
                  parsed.output ??
                  (parsed.choices && parsed.choices[0] && (parsed.choices[0].text ?? parsed.choices[0].message?.content)) ??
                  JSON.stringify(parsed);
                onChunk(String(text));
              } else {
                onChunk(String(parsed));
              }
            } catch {
              onChunk(payload);
            }
          } else {
            // non data: lines — send raw
            onChunk(line);
          }
        }
      }

      // If buffer grows big but contains no \n\n, emit it as partial to keep UI responsive
      if (buf.length > 4096) {
        onChunk(buf);
        buf = "";
      }
    }

    // final leftover
    if (buf.trim()) {
      // If it's SSE-style single-line events maybe separated by \n
      const lines = buf.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            onDone?.();
            return;
          }
          try {
            const parsed = JSON.parse(payload);
            const text =
              parsed.text ??
              parsed.output ??
              (parsed.choices && parsed.choices[0] && (parsed.choices[0].text ?? parsed.choices[0].message?.content)) ??
              JSON.stringify(parsed);
            onChunk(String(text));
          } catch {
            onChunk(payload);
          }
        } else {
          onChunk(line);
        }
      }
    }

    onDone?.();
  } catch (err: any) {
    const e = new Error(String(err?.message || err));
    onError?.(e);
    throw e;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

export default {
  generateLocalPlan,
  generateLocalText,
  streamLocalGenerate
};

