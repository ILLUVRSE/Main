'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '@/lib/auth';
import { useToast } from './Toast';

type ChatMessage = {
  id: string;
  who: 'user' | 'assistant' | 'system';
  text: string;
  ts?: string;
};

type ChatWidgetProps = {
  skuId?: string;
  placeholder?: string;
  compact?: boolean;
  initialSystemPrompt?: string;
};

/**
 * Simple ChatWidget for product discovery / checkout assistance.
 * - Calls a server-side agent proxy at POST /api/agent/query
 * - Shows a small chat UI with messages, input, and basic streaming support (non-stream fallback)
 *
 * Notes:
 * - This is a pragmatic client for dev and staging. Security: agent proxy must enforce policies
 *   and audit agent actions server-side; do not call OpenAI directly from the browser.
 */

export default function ChatWidget({
  skuId,
  placeholder = 'Ask about this product, pricing, or license...',
  compact = false,
  initialSystemPrompt,
}: ChatWidgetProps) {
  const { token } = useAuth();
  const { push } = useToast();

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialSystemPrompt ? [{ id: 'sys-1', who: 'system', text: initialSystemPrompt, ts: new Date().toISOString() }] : []
  );
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(!compact); // compact default collapsed
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // scroll to bottom when messages change
    if (boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [messages, open]);

  const sendMessage = useCallback(
    async (msgText: string) => {
      if (!msgText || !msgText.trim()) return;
      const id = `u_${Date.now()}`;
      const userMsg: ChatMessage = { id, who: 'user', text: msgText, ts: new Date().toISOString() };
      setMessages((m) => [...m, userMsg]);
      setText('');
      setSending(true);

      try {
        // Call the server-side agent proxy.
        // The server should be implemented at POST /api/agent/query
        const body = {
          prompt: msgText,
          context: { skuId },
        };

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        // Include client token if present; server will authenticate and audit.
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const resp = await fetch('/api/agent/query', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          throw new Error(txt || `Agent proxy error (${resp.status})`);
        }

        // Expect JSON { reply: string, actions?: [] }
        const json = await resp.json().catch(() => ({}));
        const replyText = (json && (json.reply || json.text || json.result || JSON.stringify(json))) || '';

        const assistantMsg: ChatMessage = {
          id: `a_${Date.now()}`,
          who: 'assistant',
          text: replyText,
          ts: new Date().toISOString(),
        };

        setMessages((m) => [...m, assistantMsg]);
      } catch (err: any) {
        // show error as assistant message and toast
        const errMsg = String(err?.message || err || 'Agent request failed');
        setMessages((m) => [
          ...m,
          { id: `a_err_${Date.now()}`, who: 'assistant', text: `Error: ${errMsg}`, ts: new Date().toISOString() },
        ]);
        push({ message: `Agent error: ${errMsg}`, level: 'error' });
      } finally {
        setSending(false);
      }
    },
    [skuId, token, push]
  );

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!text.trim()) return;
    await sendMessage(text.trim());
  };

  return (
    <div className={clsx('relative', compact ? 'w-64' : 'w-96')}>
      {/* Toggle header */}
      <div
        className="flex items-center justify-between gap-2 cursor-pointer p-2 rounded-md bg-white shadow-illuvrse-soft"
        onClick={() => setOpen((o) => !o)}
        role="button"
        aria-pressed={open}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[var(--illuvrse-primary)] flex items-center justify-center text-white font-bold">A</div>
          <div className="text-sm">
            <div className="font-semibold">Assistant</div>
            <div className="text-xs text-muted">Ask about this SKU</div>
          </div>
        </div>

        <div>
          <button className="btn-ghost text-sm" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse' : 'Open'}>
            {open ? '–' : '+'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 bg-white rounded-md shadow-illuvrse-strong overflow-hidden">
          <div ref={boxRef} className="max-h-60 overflow-auto p-3 space-y-3">
            {messages.length === 0 && <div className="text-sm text-muted">Ask the assistant for quick help.</div>}
            {messages.map((m) => (
              <div key={m.id} className={clsx('p-2 rounded-md', m.who === 'user' ? 'bg-gray-50 self-end text-sm' : 'bg-[var(--illuvrse-primary-light)] text-white text-sm')}>
                <div className="whitespace-pre-wrap">{m.text}</div>
                <div className="text-xs text-muted mt-1">{m.ts ? new Date(m.ts).toLocaleTimeString() : ''}</div>
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="p-3 border-t bg-gray-50">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={placeholder}
              rows={2}
              className="w-full rounded-md border p-2 text-sm"
              disabled={sending}
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="text-xs text-muted">Powered by Agent Builder (via server proxy)</div>
              <div className="flex items-center gap-2">
                <button type="submit" className="btn-primary text-sm" disabled={sending}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

