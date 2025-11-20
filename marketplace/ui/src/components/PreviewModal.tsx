'use client';

import React from 'react';
import type { PreviewSession } from '@/types';

type Props = {
  skuId: string | null;
  session: PreviewSession | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
  onOpenConsole?: (endpoint?: string) => void;
};

/**
 * PreviewModal
 *
 * Reusable modal that displays preview session information returned by POST /sku/{id}/preview.
 * - session: { session_id, endpoint, expires_at }
 * - onOpenConsole: optional handler to open an embedded console or external preview window
 *
 * The SKU page used an inline modal; this component centralizes the modal UI so other pages
 * can reuse it (catalog quick-preview, admin debug, etc.).
 */

export default function PreviewModal({
  skuId,
  session,
  loading,
  error,
  onRetry,
  onClose,
  onOpenConsole,
}: Props) {
  if (!skuId) return null;

  const { session_id, endpoint, expires_at } = session || {};

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Preview session">
      <div className="bg-white rounded-lg shadow-illuvrse-strong max-w-3xl w-full p-6 mx-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xl font-semibold">Preview Session</h3>
            <p className="text-sm text-muted mt-1">Ephemeral preview environment for SKU testing.</p>
            <p className="text-xs text-muted mt-1">SKU: <span className="font-mono">{skuId}</span></p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-ghost">Close</button>
          </div>
        </div>

        {loading && (
          <div className="mt-6 text-center text-sm text-muted">
            Provisioning sandbox… this typically takes a few seconds.
          </div>
        )}

        {!loading && error && (
          <div className="mt-6 bg-red-50 text-red-700 text-sm rounded p-3 flex items-center justify-between">
            <span>{error}</span>
            <button className="btn-ghost text-xs" onClick={onRetry}>Retry</button>
          </div>
        )}

        {!loading && !error && session && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted">Session ID</div>
            <div className="mt-1 font-mono text-sm break-all">{session_id}</div>

            <div className="text-sm text-muted mt-3">Expires at</div>
            <div className="mt-1 text-sm">{expires_at || '—'}</div>
          </div>

          <div>
            <div className="text-sm text-muted">Endpoint</div>
            <div className="mt-1">
              <code className="block text-xs bg-gray-50 p-2 rounded break-all">{endpoint || '—'}</code>
            </div>

            <div className="mt-4 flex gap-3">
              <a
                className="btn-primary"
                href={endpoint || '#'}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  if (!endpoint) {
                    e.preventDefault();
                    return;
                  }
                }}
              >
                Open Preview
              </a>

              <button
                className="btn-outline"
                onClick={() => {
                  if (onOpenConsole) onOpenConsole(endpoint);
                  else {
                    // default dev behavior: open in new tab
                    if (endpoint) window.open(endpoint, '_blank', 'noopener');
                  }
                }}
              >
                Open Console
              </button>

              <button
                className="btn-ghost"
                onClick={() => {
                  try {
                    const payload = { session_id, endpoint, expires_at };
                    navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
                    // eslint-disable-next-line no-alert
                    alert('Preview session copied to clipboard');
                  } catch {
                    // eslint-disable-next-line no-alert
                    alert('Copy failed');
                  }
                }}
              >
                Copy Info
              </button>
            </div>
          </div>
        </div>
        )}

        <div className="mt-6 text-sm text-muted">
          <p>
            The preview environment runs a deterministic workload in an isolated sandbox. Audit events
            are emitted for session lifecycle (`preview.started`, `preview.completed`, `preview.expired`).
          </p>
          {!loading && !session && !error && (
            <p className="mt-2">No session details yet. Use the Retry button to request a new sandbox.</p>
          )}
        </div>
      </div>
    </div>
  );
}
