import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Streaming agent proxy
 *
 * Proxies a streaming response from the Marketplace backend agent streaming endpoint:
 *   <MARKETPLACE_BASE>/api/agent/query/stream
 *
 * It relays the streaming bytes to the client as-is (SSE or newline-delimited JSON).
 * This keeps the browser from talking to backend/LLM directly and lets the server
 * enforce auth/policy/audit.
 *
 * Note: the backend must support streaming responses (SSE or newline-delimited JSON).
 * This handler reads the backend response body and writes chunks to the HTTP response.
 */

const BACKEND_BASE =
  process.env.MARKETPLACE_BASE ||
  process.env.NEXT_PUBLIC_MARKETPLACE_BASE_URL ||
  'http://127.0.0.1:3000';

const TARGET = `${BACKEND_BASE.replace(/\/$/, '')}/api/agent/query/stream`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  }

  try {
    // forward headers (authorization + x-request-id if present)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (req.headers.authorization) headers['Authorization'] = String(req.headers.authorization);
    if (req.headers['x-request-id']) headers['X-Request-Id'] = String(req.headers['x-request-id']);

    // Initiate fetch to backend streaming endpoint
    const backendRes = await fetch(TARGET, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });

    // Mirror status if backend returned non-200 and non-stream body
    if (!backendRes.ok) {
      const txt = await backendRes.text().catch(() => '');
      res.status(backendRes.status).json({ ok: false, error: { message: 'Agent backend error', details: txt } });
      return;
    }

    // If backend did not provide a body, return an error
    if (!backendRes.body) {
      const txt = await backendRes.text().catch(() => '');
      res.status(502).json({ ok: false, error: { message: 'Backend did not provide a stream', details: txt } });
      return;
    }

    // Setup response headers for streaming. Try SSE first, fall back to text/plain
    // If backend is SSE, it will likely use 'text/event-stream' and we mirror that.
    const backendContentType = backendRes.headers.get('content-type') || 'text/event-stream';
    res.setHeader('Content-Type', backendContentType);
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no'); // disable buffering on some proxies
    // Important: do not call res.json / res.end immediately. We'll stream and end when backend finishes.

    // If available, flush headers immediately
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    // Stream backend body to client by reading chunks and writing them through
    const reader = (backendRes.body as ReadableStream).getReader();
    const decoder = new TextDecoder();
    let closed = false;

    async function pump() {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (closed) break;
          // Convert chunk to string and write it out
          const chunk = typeof value === 'string' ? value : decoder.decode(value);
          // Write exactly what we received from backend. This preserves SSE or ndjson framing.
          res.write(chunk);
        }
      } catch (err: any) {
        // If the client connection is closed, attempting to write may throw.
        // Log and swallow to allow cleanup.
        // eslint-disable-next-line no-console
        console.error('Agent stream pump error:', err?.message || err);
      } finally {
        // End the response when backend stream completes
        try {
          if (!closed) {
            closed = true;
            res.end();
          }
        } catch {
          // ignore
        }
      }
    }

    // Start pumping without awaiting, so we can return control to Next.js immediately
    pump().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Agent stream pump top-level error:', err?.message || err);
      try {
        if (!closed) {
          closed = true;
          res.end();
        }
      } catch {
        // ignore
      }
    });

    // Important: do not call res.json or res.end here — pump will end when done.
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('Agent stream proxy error:', err && err.message ? err.message : err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: { message: 'Agent stream proxy failed', details: String(err) } });
    } else {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  }
}

