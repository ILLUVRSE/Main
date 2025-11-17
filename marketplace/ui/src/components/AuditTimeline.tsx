'use client';

import React, { useState } from 'react';
import clsx from 'clsx';
import type { AuditRow } from '@/types';

type Props = {
  events?: AuditRow[]; // optional pre-fetched events
  orderId?: string; // optional orderId (if you want to fetch events elsewhere)
  onVerify?: (event: AuditRow) => Promise<{ ok: boolean; details?: any }>; // optional verification handler
  className?: string;
};

/**
 * AuditTimeline
 *
 * Renders a vertical timeline of audit events with hash/prev_hash, signatures, and payload.
 * - If `onVerify` is provided, renders a "Verify" button per event and shows verification result.
 *
 * This component assumes events are canonicalized JSON-like objects with fields:
 *  { actor_id, event_type, payload, hash, prev_hash, signature, signer_kid, created_at }
 */

export default function AuditTimeline({ events = [], onVerify, className }: Props) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [verifyingIds, setVerifyingIds] = useState<Record<string, boolean>>({});
  const [verifyResults, setVerifyResults] = useState<Record<string, { ok: boolean; details?: any }>>({});

  const toggle = (id?: string) => {
    if (!id) return;
    setExpandedIds((s) => ({ ...s, [id]: !s[id] }));
  };

  const handleVerify = async (evt: AuditRow) => {
    if (!onVerify) return;
    const id = evt.hash || String(evt.created_at || Math.random());
    try {
      setVerifyingIds((s) => ({ ...s, [id]: true }));
      const res = await onVerify(evt);
      setVerifyResults((s) => ({ ...s, [id]: res }));
    } catch (e: any) {
      setVerifyResults((s) => ({ ...s, [id]: { ok: false, details: e?.message || e } }));
    } finally {
      setVerifyingIds((s) => ({ ...s, [id]: false }));
    }
  };

  if (!events || events.length === 0) {
    return <div className={clsx('text-muted', className)}>No audit events available.</div>;
  }

  return (
    <div className={clsx('space-y-4', className)}>
      {events.map((e, idx) => {
        const id = e.hash || `${e.event_type}-${idx}`;
        const expanded = !!expandedIds[id];
        const verifying = !!verifyingIds[id];
        const verifyRes = verifyResults[id];

        return (
          <div key={id} className="flex items-start gap-4">
            {/* Timeline marker */}
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 rounded-full bg-[var(--illuvrse-primary)]" />
              {idx < events.length - 1 && <div className="w-px h-full bg-gray-200 mt-1" style={{ minHeight: 24 }} />}
            </div>

            <div className="flex-1">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold">{e.event_type}</div>
                  <div className="text-xs text-muted">
                    {e.actor_id ? <span className="mr-2">{e.actor_id}</span> : null}
                    <span>{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-muted">hash</div>
                  <div className="font-mono text-xs break-all max-w-[28ch]">{e.hash || '—'}</div>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {e.signature ? (
                    <div className="inline-flex items-center gap-2">
                      <span className="illuvrse-badge bg-green-50 text-green-700">signed</span>
                      <span className="text-xs text-muted">{e.signer_kid || 'unknown-signer'}</span>
                    </div>
                  ) : (
                    <span className="illuvrse-badge bg-gray-100 text-muted">unsigned</span>
                  )}

                  <button
                    className="btn-ghost text-xs"
                    onClick={() => toggle(id)}
                    aria-expanded={expanded}
                  >
                    {expanded ? 'Hide payload' : 'Show payload'}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs text-muted mr-2">prev</div>
                  <div className="font-mono text-xs break-all max-w-[18ch]">{e.prev_hash || '—'}</div>

                  {onVerify && (
                    <button
                      className="btn-outline text-xs ml-3"
                      onClick={() => handleVerify(e)}
                      disabled={verifying}
                    >
                      {verifying ? 'Verifying…' : 'Verify'}
                    </button>
                  )}
                </div>
              </div>

              {expanded && (
                <div className="mt-3 bg-gray-50 p-3 rounded text-sm">
                  <pre className="whitespace-pre-wrap break-all">{JSON.stringify(e.payload || {}, null, 2)}</pre>
                  {e.signature && (
                    <div className="mt-3 text-xs text-muted">
                      <div><strong>Signature:</strong> <span className="font-mono break-all">{e.signature}</span></div>
                      <div className="mt-1"><strong>Signer KID:</strong> {e.signer_kid || '—'}</div>
                    </div>
                  )}
                </div>
              )}

              {verifyRes && (
                <div className={`mt-3 p-3 rounded ${verifyRes.ok ? 'proof-success' : 'bg-yellow-50'}`}>
                  <div className="font-semibold">{verifyRes.ok ? 'Verified' : 'Verification failed'}</div>
                  <pre className="mt-2 text-sm overflow-auto">{JSON.stringify(verifyRes.details || {}, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

