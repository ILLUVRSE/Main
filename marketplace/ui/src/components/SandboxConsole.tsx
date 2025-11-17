'use client';

import React, { useEffect, useRef, useState } from 'react';

type SandboxConsoleProps = {
  endpoint?: string | null; // wss://...
  sessionId?: string | null;
  autoConnect?: boolean;
  onClose?: () => void;
};

/**
 * SandboxConsole
 *
 * Lightweight WebSocket-based console for preview sessions.
 * - Connects to a wss:// endpoint and shows incoming messages in a scrollable log.
 * - Allows sending text messages to the sandbox and supports simple JSON pretty-print.
 * - For dev use only: no authentication logic here — the server/cdn should secure endpoints.
 */

export default function SandboxConsole({ endpoint, sessionId, autoConnect = false, onClose }: SandboxConsoleProps) {
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<Array<{ ts: string; direction: 'in' | 'out' | 'sys'; msg: string }>>([]);
  const [input, setInput] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // auto-scroll to bottom when logs change
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (autoConnect && endpoint) {
      connect();
    }
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, autoConnect]);

  function appendLog(direction: 'in' | 'out' | 'sys', msg: string) {
    setLogs((l) => [...l, { ts: new Date().toISOString(), direction, msg }]);
  }

  function connect() {
    if (!endpoint) {
      appendLog('sys', 'No endpoint provided');
      return;
    }
    try {
      disconnect();
      appendLog('sys', `Connecting to ${endpoint} ...`);
      const ws = new WebSocket(endpoint);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        appendLog('sys', 'Connected');
        // Optionally send a hello with session id
        if (sessionId) {
          try {
            ws.send(JSON.stringify({ type: 'hello', session_id: sessionId }));
            appendLog('out', JSON.stringify({ type: 'hello', session_id: sessionId }));
          } catch {
            // ignore
          }
        }
      };

      ws.onmessage = (ev) => {
        const data = ev.data;
        let text = String(data);
        // Try to pretty-print JSON
        try {
          const parsed = JSON.parse(text);
          text = JSON.stringify(parsed, null, 2);
        } catch {
          // leave as-is
        }
        appendLog('in', text);
      };

      ws.onclose = (ev) => {
        setConnected(false);
        appendLog('sys', `Disconnected (code=${ev.code})`);
      };

      ws.onerror = (ev) => {
        appendLog('sys', 'WebSocket error');
      };
    } catch (err: any) {
      appendLog('sys', `Connect failed: ${String(err?.message || err)}`);
    }
  }

  function disconnect() {
    try {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    } catch {
      // ignore
    } finally {
      setConnected(false);
    }
  }

  function sendMessage() {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      appendLog('sys', 'WebSocket not connected');
      return;
    }
    const msg = input || '';
    try {
      wsRef.current.send(msg);
      appendLog('out', msg);
      setInput('');
    } catch (err: any) {
      appendLog('sys', `Send error: ${String(err?.message || err)}`);
    }
  }

  return (
    <div className="bg-white rounded-md shadow-illuvrse-soft p-3 w-full">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm text-muted">Sandbox Console</div>
          <div className="text-xs text-muted">{sessionId ? `session: ${sessionId}` : 'no session'}</div>
        </div>

        <div className="flex items-center gap-2">
          <div className={`text-xs px-2 py-1 rounded ${connected ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-800'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </div>

          {connected ? (
            <button className="btn-ghost text-sm" onClick={() => { disconnect(); onClose?.(); }}>
              Disconnect
            </button>
          ) : (
            <button className="btn-primary text-sm" onClick={connect} disabled={!endpoint}>
              Connect
            </button>
          )}
        </div>
      </div>

      <div ref={containerRef} className="bg-gray-50 p-3 rounded h-56 overflow-auto text-sm font-mono">
        {logs.length === 0 && <div className="text-muted">No messages yet.</div>}
        {logs.map((l, i) => (
          <div key={i} className="mb-2">
            <div className="text-xs text-muted">{new Date(l.ts).toLocaleTimeString()}</div>
            <pre className={l.direction === 'in' ? 'text-left' : 'text-right'}>{l.msg}</pre>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Send message to sandbox..."
          className="flex-1 rounded-md border px-3 py-2"
        />
        <button className="btn-outline" onClick={sendMessage} disabled={!connected || !input}>
          Send
        </button>
      </div>
    </div>
  );
}

