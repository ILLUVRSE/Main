'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import type { RoyaltySplit } from '@/types';

/**
 * Admin Finance page
 *
 * - Shows royalty rules and recent ledger batches.
 * - Provides simple reconciliation helpers (trigger a reconciliation job).
 * - Expects server endpoints:
 *   GET  /admin/finance/royalties         -> { ok:true, royalties: [ { sku_id, rule, created_at } ] }
 *   GET  /admin/finance/ledger?limit=50   -> { ok:true, ledger: [ { ledger_id, timestamp, lines: [...] } ] }
 *   POST /admin/finance/reconcile         -> { ok:true, result: {...} }
 *
 * The server must enforce operator auth and provide the ledger/royalty shapes.
 */

type RoyaltyRow = {
  sku_id: string;
  rule: any;
  created_at?: string;
};

type LedgerLine = {
  accountId?: string;
  direction?: 'debit' | 'credit';
  amount?: number;
  metadata?: any;
};

type LedgerEntry = {
  ledger_id: string;
  timestamp?: string;
  lines?: LedgerLine[];
  metadata?: any;
};

export default function AdminFinancePage() {
  const { isOperator, token } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [royalties, setRoyalties] = useState<RoyaltyRow[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reconRunning, setReconRunning] = useState(false);

  useEffect(() => {
    if (!isOperator()) {
      setLoading(false);
      return;
    }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOperator, token]);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const [rRes, lRes] = await Promise.all([
        fetch('/admin/finance/royalties', { headers }),
        fetch('/admin/finance/ledger?limit=50', { headers }),
      ]);

      if (!rRes.ok) throw new Error(`Failed to fetch royalties (${rRes.status})`);
      if (!lRes.ok) throw new Error(`Failed to fetch ledger (${lRes.status})`);

      const rJson = await rRes.json();
      const lJson = await lRes.json();

      setRoyalties(rJson.royalties || []);
      setLedger(lJson.ledger || []);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Finance fetch error', err);
      setError(err?.message || 'Failed to load finance data');
    } finally {
      setLoading(false);
    }
  }

  async function handleReconcile() {
    if (!confirm('Run reconciliation job? This may be asynchronous and produce logs.')) return;
    setReconRunning(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/admin/finance/reconcile', { method: 'POST', headers });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `Reconcile failed (${res.status})`);
      }
      const json = await res.json();
      toast.push({ message: 'Reconciliation started', level: 'success' });
      // Optionally display immediate result if provided
      if (json.result) {
        toast.push({ message: `Result: ${JSON.stringify(json.result)}`, level: 'info', durationMs: 7000 });
      }
      // refresh ledger view
      fetchData();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Reconcile failed', err);
      toast.push({ message: `Reconcile failed: ${String(err?.message || err)}`, level: 'error' });
    } finally {
      setReconRunning(false);
    }
  }

  if (!isOperator()) {
    return (
      <div className="card">
        <div className="text-sm text-muted">Operator access required to view finance dashboard.</div>
      </div>
    );
  }

  return (
    <section>
      <h2 className="text-2xl font-heading font-bold mb-3">Finance & Royalties</h2>

      {loading ? (
        <div className="card">Loading…</div>
      ) : error ? (
        <div className="card text-red-600">Error: {error}</div>
      ) : (
        <div className="space-y-6">
          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Royalty rules</h3>
                <div className="text-sm text-muted mt-1">SKU-level royalty rules and metadata (auditable).</div>
              </div>
              <div>
                <button className="btn-outline" onClick={() => fetchData()}>Refresh</button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {royalties.length === 0 && <div className="text-muted">No royalty rules found.</div>}
              {royalties.map((r) => (
                <div key={r.sku_id} className="p-3 bg-gray-50 rounded flex items-start justify-between">
                  <div>
                    <div className="font-medium">{r.sku_id}</div>
                    <div className="text-sm text-muted mt-1">Created: {r.created_at || '—'}</div>
                    <div className="mt-2 text-sm">
                      <pre className="bg-white p-2 rounded text-sm overflow-auto">{JSON.stringify(r.rule || {}, null, 2)}</pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Recent ledger entries</h3>
                <div className="text-sm text-muted mt-1">Latest ledger batches and their journal lines.</div>
              </div>

              <div className="flex items-center gap-2">
                <button className="btn-outline" onClick={() => fetchData()}>Refresh</button>
                <button className="btn-primary" onClick={handleReconcile} disabled={reconRunning}>
                  {reconRunning ? 'Reconciling…' : 'Run Reconciliation'}
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {ledger.length === 0 && <div className="text-muted">No ledger entries found.</div>}
              {ledger.map((l) => (
                <div key={l.ledger_id} className="p-3 bg-gray-50 rounded">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">Ledger {l.ledger_id}</div>
                      <div className="text-sm text-muted mt-1">Timestamp: {l.timestamp || '—'}</div>
                    </div>

                    <div className="text-sm text-muted">Lines: {(l.lines || []).length}</div>
                  </div>

                  <div className="mt-3">
                    <div className="text-sm font-semibold">Journal lines</div>
                    <div className="mt-2 space-y-2 text-sm">
                      {(l.lines || []).map((ln: LedgerLine, idx: number) => (
                        <div key={idx} className="p-2 bg-white rounded flex justify-between items-center">
                          <div>
                            <div className="font-mono">{ln.accountId || '—'}</div>
                            <div className="text-xs text-muted mt-1">{ln.direction}</div>
                          </div>
                          <div className="text-sm">{typeof ln.amount === 'number' ? `$${(ln.amount / 100).toFixed(2)}` : '—'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

