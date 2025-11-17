'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import Link from 'next/link';

/**
 * Admin Dashboard
 *
 * Shows a compact overview for operators: counts (SKUs, orders, active preview sessions),
 * last audit export, and quick actions (run audit export, trigger reconcile, open signer registry).
 *
 * Expects server to provide a convenience endpoint:
 *   GET /admin/summary -> { ok:true, summary: { skus, orders, previews, lastAuditExport, lastReconcile } }
 *
 * If that endpoint isn't present, the dashboard will show basic navigation only.
 */

type Summary = {
  skus?: number;
  orders?: number;
  previews?: number;
  lastAuditExport?: string;
  lastReconcile?: string;
};

export default function AdminDashboardPage() {
  const { isOperator, token } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState<boolean>(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningAudit, setRunningAudit] = useState(false);
  const [runningRecon, setRunningRecon] = useState(false);

  useEffect(() => {
    if (!isOperator()) {
      setLoading(false);
      return;
    }
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOperator, token]);

  async function fetchSummary() {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/admin/summary', { headers });
      if (!res.ok) {
        // gracefully degrade if summary endpoint not implemented
        setSummary(null);
        setLoading(false);
        return;
      }
      const json = await res.json();
      setSummary(json.summary || null);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch admin summary', err);
      setError(err?.message || 'Failed to fetch summary');
    } finally {
      setLoading(false);
    }
  }

  async function handleRunAuditExport() {
    if (!confirm('Run an audit export now? This will start an export job.')) return;
    setRunningAudit(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const body = {
        from: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // last hour
        to: new Date().toISOString(),
        envTag: 'prod',
      };
      const res = await fetch('/admin/audit/export', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `Export failed (${res.status})`);
      }
      const json = await res.json();
      toast.push({ message: `Audit export started: ${json.location || 'started'}`, level: 'success' });
      fetchSummary();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Audit export failed', err);
      toast.push({ message: `Audit export failed: ${String(err?.message || err)}`, level: 'error' });
    } finally {
      setRunningAudit(false);
    }
  }

  async function handleRunReconcile() {
    if (!confirm('Run finance reconciliation now?')) return;
    setRunningRecon(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/admin/finance/reconcile', { method: 'POST', headers });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `Reconcile failed (${res.status})`);
      }
      const json = await res.json();
      toast.push({ message: `Reconcile started`, level: 'success' });
      fetchSummary();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Reconcile failed', err);
      toast.push({ message: `Reconcile failed: ${String(err?.message || err)}`, level: 'error' });
    } finally {
      setRunningRecon(false);
    }
  }

  if (!isOperator()) {
    return (
      <div className="card">
        <div className="text-sm text-muted">Operator access required to view admin dashboard.</div>
      </div>
    );
  }

  return (
    <section>
      <h2 className="text-2xl font-heading font-bold mb-3">Admin Dashboard</h2>

      {loading ? (
        <div className="card">Loading summary…</div>
      ) : error ? (
        <div className="card text-red-600">Error: {error}</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="card">
              <div className="text-sm text-muted">SKUs</div>
              <div className="text-3xl font-semibold mt-2">{summary?.skus ?? '—'}</div>
              <div className="mt-3 text-sm">
                <Link href="/admin/sku/new" className="btn-outline">Register SKU</Link>
              </div>
            </div>

            <div className="card">
              <div className="text-sm text-muted">Orders</div>
              <div className="text-3xl font-semibold mt-2">{summary?.orders ?? '—'}</div>
              <div className="mt-3 text-sm">
                <Link href="/marketplace" className="btn-outline">View Marketplace</Link>
              </div>
            </div>

            <div className="card">
              <div className="text-sm text-muted">Active previews</div>
              <div className="text-3xl font-semibold mt-2">{summary?.previews ?? '—'}</div>
              <div className="mt-3 text-sm">
                <Link href="/admin/sandbox" className="btn-outline">Manage Sandbox</Link>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="text-lg font-semibold">Audit</h3>
              <div className="mt-2 text-sm text-muted">Last export: {summary?.lastAuditExport || '—'}</div>

              <div className="mt-4 flex gap-3">
                <button className="btn-primary" onClick={handleRunAuditExport} disabled={runningAudit}>
                  {runningAudit ? 'Exporting…' : 'Run Audit Export'}
                </button>
                <Link href="/admin/audit" className="btn-ghost">Audit Tools</Link>
              </div>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold">Finance</h3>
              <div className="mt-2 text-sm text-muted">Last reconcile: {summary?.lastReconcile || '—'}</div>

              <div className="mt-4 flex gap-3">
                <button className="btn-primary" onClick={handleRunReconcile} disabled={runningRecon}>
                  {runningRecon ? 'Reconciling…' : 'Run Reconciliation'}
                </button>
                <Link href="/admin/finance" className="btn-ghost">Finance Dashboard</Link>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="card">
              <h3 className="text-lg font-semibold">Quick links</h3>
              <div className="mt-3 flex flex-wrap gap-3">
                <Link href="/admin/signers" className="btn-outline">Signer Registry</Link>
                <Link href="/admin/sku/new" className="btn-outline">Register SKU</Link>
                <Link href="/admin/sandbox" className="btn-outline">Sandbox Admin</Link>
                <Link href="/admin/audit" className="btn-outline">Audit Export</Link>
                <Link href="/admin/finance" className="btn-outline">Finance</Link>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

