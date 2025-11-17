import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Simple agent proxy
 *
 * Forwards the client request to the configured Marketplace backend agent endpoint:
 *   <MARKETPLACE_BASE>/api/agent/query
 *
 * It forwards Authorization if present and returns JSON responses (non-streaming).
 * If your backend implements streaming, replace this handler with a streaming proxy.
 *
 * ENV:
 *  - MARKETPLACE_BASE (falls back to NEXT_PUBLIC_MARKETPLACE_BASE_URL)
 *
 * Security note:
 *  - The backend must authenticate and audit agent calls; this proxy simply relays the request.
 *  - Do NOT embed privileged keys in client-side code.
 */

const BACKEND_BASE =
  process.env.MARKETPLACE_BASE ||
  process.env.NEXT_PUBLIC_MARKETPLACE_BASE_URL ||
  'http://127.0.0.1:3000';

const TARGET = `${BACKEND_BASE.replace(/\/$/, '')}/api/agent/query`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST for queries
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  }

  try {
    // Forward headers: include authorization if present.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (req.headers.authorization) headers['Authorization'] = String(req.headers.authorization);
    // You can forward other headers if needed (x-request-id etc.)
    if (req.headers['x-request-id']) headers['X-Request-Id'] = String(req.headers['x-request-id']);

    const fetchRes = await fetch(TARGET, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });

    const text = await fetchRes.text();
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON response; pass through as text
      payload = { ok: fetchRes.ok, text };
    }

    // Mirror status
    res.status(fetchRes.status).json(payload);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('Agent proxy error:', err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, error: { message: 'Agent proxy failed', details: String(err) } });
  }
}

