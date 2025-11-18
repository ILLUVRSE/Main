'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

/**
 * Preview Debug Page
 *
 * Client-only page reachable at /preview-debug/[sessionId]
 *
 * Features:
 * - Accepts an endpoint (wss:// or https://) to connect to
 * - Connects via WebSocket and shows incoming messages
 * - Allows sending a test message
 * - "Fetch session" button attempts to GET /preview-sessions/{sessionId} (best-effort)
 */

export default function PreviewDebugPage() {
  const params = useParams();
  const sessionId = typeof params === 'object' && params?.sessionId ? String(params.sessionId) : '';

  const [endpoint, setEndpoint] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle');
  const [messages, setMessages] = useState<string[]>([]);
  const [sendText, setSendText] = useState<string>('');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // auto-fill endpoint if environment provides a hint via window.__PREVIEW_ENDPOINT__
    // (useful in some debug flows). Not required.
    if ((window as any).__PREVIEW_ENDPOINT__) {
      setEndpoint((window as any).__PREVIEW_ENDPOINT__);
    }
    return () => {
      // cleanup
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, []);

  function append(msg: string) {
    setMessages((m) => [...m.slice(-199), msg]); // cap at 200 messages
  }

  function connect() {
    if (!endpoint) {
      append('No endpoint provided.');
      setStatus('error');
      return;
    }
    try {
      setStatus('connecting');
      const ws = new WebSocket(endpoint);
      ws.onopen = () => {
        wsRef.current = ws;
        setStatus('open');
        append('[open] connected');
      };
      ws.onmessage = (ev) => {
        const text = typeof ev.data === 'string' ? ev.data : '[binary data]';
        append(`[in] ${text}`);
      };
      ws.onclose = (ev) => {
        append(`[close] code=${ev.code} reason=${ev.reason || 'n/a'}`);
        setStatus('closed');
        wsRef.current = null;
      };
      ws.onerror = (ev) => {
        append('[error] WebSocket error');
        setStatus('error');
      };
    } catch (err: any) {
      append(`[error] ${String(err?.message || err)}`);
      setStatus('error');
    }
  }

  function disconnect() {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    setStatus('closed');
    append('[closed by user]');
  }

  function sendMessage() {
    if (!wsRef.current || status !== 'open') {
      append('[error] Not connected');
      return;
    }
    try {
      wsRef.current.send(sendText);
      append(`[out] ${sendText}`);
      setSendText('');
    } catch (err: any) {
      append(`[error] send failed: ${String(err?.message || err)}`);
    }
  }

  async function fetchSession() {
    if (!sessionId) {
      append('[error] missing sessionId in URL');
      return;
    }
    try {
      append(`[fetch] /preview-sessions/${sessionId}`);
      const res = await fetch(`/preview-sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
      if (!res.ok) {
        const text = await res.text();
        append(`[fetch] failed: ${res.status} ${res.statusText} - ${text}`);
        return;
      }
      const payload = await res.json();
      append(`[fetch] ok: ${JSON.stringify(payload)}`);
      // If payload has an endpoint, auto-fill it
      if (payload?.endpoint && typeof payload.endpoint === 'string') {
        setEndpoint(payload.endpoint);
        append(`[fetch] endpoint auto-filled: ${payload.endpoint}`);
      }
    } catch (err: any) {
      append(`[fetch] error: ${String(err?.message || err)}`);
    }
  }

  return (
    <div className="container p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-heading font-bold">Preview Debug</h1>
        <p className="text-sm text-muted mt-1">
          Session: <span className="font-mono">{sessionId || '<none>'}</span>
        </p>
      </header>

      <section className="illuvrse-card p-4 mb-6">
        <div className="grid grid-cols-1 gap-3">
          <label className="text-sm text-muted">Endpoint (wss:// or https://)</label>
          <div className="flex gap-3 items-center">
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="wss://... or https://..."
              className="flex-1 border rounded px-3 py-2 text-sm"
            />
            <button onClick={connect} className="btn-primary text-sm">Connect</button>
            <button onClick={disconnect} className="btn-ghost text-sm">Disconnect</button>
            <button onClick={() => { if (endpoint) window.open(endpoint, '_blank', 'noopener'); }} className="btn-outline text-sm">Open</button>
          </div>

          <div className="flex gap-3">
            <button onClick={fetchSession} className="btn-outline text-sm">Fetch session</button>
            <div className="text-sm text-muted ml-auto">Status: <strong>{status}</strong></div>
          </div>
        </div>
      </section>

      <section className="illuvrse-card p-4 mb-6">
        <h2 className="text-lg font-semibold mb-2">Live console</h2>
        <div className="bg-black text-white p-3 rounded h-64 overflow-auto" aria-live="polite">
          {messages.length === 0 ? (
            <div className="text-sm text-muted">No messages yet.</div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className="text-xs font-mono mb-1 break-words">{m}</div>
            ))
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={sendText}
            onChange={(e) => setSendText(e.target.value)}
            placeholder="Message to send"
            className="flex-1 border rounded px-3 py-2 text-sm"
          />
          <button onClick={sendMessage} className="btn-primary text-sm">Send</button>
        </div>
      </section>

      <section className="illuvrse-card p-4">
        <h3 className="text-md font-semibold mb-2">Notes</h3>
        <ul className="text-sm text-muted list-disc pl-5">
          <li>Use this page to test preview sandbox endpoints (WebSocket or HTTP).</li>
          <li>If your preview endpoint is a WebSocket, Connect will open a WebSocket and show live messages.</li>
          <li>The "Fetch session" button will attempt <code>/preview-sessions/{'{sessionId}'}</code> — your backend must implement this for auto-fetch to work.</li>
          <li>This page is intended for QA and operator use; do not expose to public users in production.</li>
        </ul>
      </section>
    </div>
  );
}

