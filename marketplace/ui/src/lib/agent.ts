/**
 * marketplace/ui/src/lib/agent.ts
 *
 * Lightweight client for the server-side Agent proxy (POST /api/agent/query).
 * - queryAgent: simple request/response.
 * - queryAgentStream: basic SSE-style streaming support (fallbacks to non-stream).
 *
 * IMPORTANT:
 * Do not call OpenAI or other LLMs directly from the browser with privileged keys.
 * The server-side agent proxy must authenticate, enrich context, authorize actions,
 * run agent logic (OpenAI Agent Builder / Actions), and audit the calls.
 */

type AgentResponse = {
  reply?: string;
  text?: string;
  actions?: any[]; // action descriptors returned by the agent (optional)
  meta?: any;
};

type AgentQueryOpts = {
  token?: string | null;
  signal?: AbortSignal | null;
  // if the server supports streaming, `stream` can be true to attempt a streaming connection
  stream?: boolean;
};

export async function queryAgent(
  prompt: string,
  context: Record<string, any> = {},
  opts: AgentQueryOpts = {}
): Promise<AgentResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  const body = { prompt, context };

  const res = await fetch('/api/agent/query', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal ?? undefined,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `Agent proxy error (${res.status})`);
  }

  // Try parse JSON
  const json = await res.json().catch(() => ({}));
  const reply = (json.reply || json.text || json.result || '') as string;
  return { reply, actions: json.actions || [], meta: json.meta || {} };
}

/**
 * queryAgentStream:
 * - Attempts to open an EventSource-like fetch stream if the server supports SSE or a line-delimited JSON stream.
 * - `onMessage` is called as chunks arrive with { type, data } where type can be 'chunk'|'done'|'error'.
 *
 * NOTE: This is a best-effort helper — server must support streaming responses (SSE or newline-delimited JSON).
 */
export async function queryAgentStream(
  prompt: string,
  context: Record<string, any> = {},
  opts: AgentQueryOpts & { onMessage: (msg: { type: 'chunk' | 'done' | 'error'; data?: any }) => void }
): Promise<void> {
  // If server explicitly supports SSE at /api/agent/query/stream, prefer that
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  try {
    const res = await fetch('/api/agent/query/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt, context }),
      signal: opts.signal ?? undefined,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      opts.onMessage({ type: 'error', data: txt || `Stream error (${res.status})` });
      return;
    }

    if (!res.body) {
      // No streaming body; fall back to non-streaming query
      const json = await res.json().catch(() => ({}));
      opts.onMessage({ type: 'chunk', data: json });
      opts.onMessage({ type: 'done', data: null });
      return;
    }

    // Read the stream as text and parse newline-delimited JSON or SSE-like lines
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // handle newline-delimited JSON chunks
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          // support SSE "data:" lines or raw JSON
          const parsed = line.startsWith('data:') ? JSON.parse(line.replace(/^data:\s*/, '')) : JSON.parse(line);
          opts.onMessage({ type: 'chunk', data: parsed });
        } catch {
          // non-JSON chunk, deliver raw string
          opts.onMessage({ type: 'chunk', data: line });
        }
      }
    }

    // flush remaining buffer
    if (buf.trim()) {
      try {
        const parsed = JSON.parse(buf);
        opts.onMessage({ type: 'chunk', data: parsed });
      } catch {
        opts.onMessage({ type: 'chunk', data: buf });
      }
    }

    opts.onMessage({ type: 'done' });
  } catch (err: any) {
    opts.onMessage({ type: 'error', data: err?.message || String(err) });
  }
}

export default {
  queryAgent,
  queryAgentStream,
};

