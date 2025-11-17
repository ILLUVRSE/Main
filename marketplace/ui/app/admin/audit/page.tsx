'use client';

import React, { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';

/**
 * Admin Audit export page
 *
 * - Allows operator to export audit events for a time range and upload to S3 (server handles export).
 * - Calls POST /admin/audit/export with body { from, to, envTag, outPath? }
 * - Server responds with { ok:true, location: 's3://...' } or error.
 *
 * This UI assumes the server enforces operator auth and that audit exports are protected
 * and written to an Object Lock-enabled bucket for compliance.
 */

export default function AdminAuditPage() {
  const { isOperator, token } = useAuth();
  const toast = useToast();

  const [from, setFrom] = useState<string>(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1); // default 24h ago
    return d.toISOString().slice(0, 19);
  });
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 19));
  const [envTag, setEnvTag] = useState<string>('prod');
  const [outPath, setOutPath] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOperator()) {
    return (
      <div className="card">
        <div className="text-sm text-muted">Operator access required to export audits.</div>
      </div>
    );
  }

  async function handleExport(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const body = { from: new Date(from).toISOString(), to: new Date(to).toISOString(), envTag, outPath: outPath || undefined };
      const res = await fetch('/admin/audit/export', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `Export failed (${res.status})`);
      }
      const json = await res.json();
      setResult(json);
      toast.push({ message: 'Audit export started or completed', level: 'success' });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Audit export failed', err);
      setError(err?.message || 'Export failed');
      toast.push({ message: `Export failed: ${String(err?.message || err)}`, level: 'error' });
    } finally {
      setRunning(false);
    }
  }

  return (
    <section>
      <h2 className="text-2xl font-heading font-bold mb-3">Audit Export</h2>
      <p className="text-sm text-muted mb-4">Export audit events to the audit archive (S3 with Object Lock).</p>

      <form className="grid grid-cols-1 lg:grid-cols-2 gap-6" onSubmit={handleExport}>
        <div className="card">
          <label className="block">
            <div className="text-sm font-medium">From (UTC)</div>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block w-full rounded-md border px-3 py-2" />
          </label>

          <label className="block mt-3">
            <div className="text-sm font-medium">To (UTC)</div>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block w-full rounded-md border px-3 py-2" />
          </label>

          <label className="block mt-3">
            <div className="text-sm font-medium">Environment tag</div>
            <input value={envTag} onChange={(e) => setEnvTag(e.target.value)} className="mt-1 block w-full rounded-md border px-3 py-2" />
          </label>

          <label className="block mt-3">
            <div className="text-sm font-medium">Out path (optional)</div>
            <input value={outPath} onChange={(e) => setOutPath(e.target.value)} placeholder="e.g. reasoning-graph|marketplace/2025-11-17/export.jsonl.gz" className="mt-1 block w-full rounded-md border px-3 py-2" />
            <div className="text-xs text-muted mt-1">If not provided, server will generate a path.</div>
          </label>

          <div className="mt-4 flex gap-3">
            <button className="btn-primary" type="submit" disabled={running}>
              {running ? 'Exporting…' : 'Export Audit Batch'}
            </button>

            <button type="button" className="btn-ghost" onClick={() => { setResult(null); setError(null); }}>
              Clear
            </button>
          </div>

          {error && <div className="mt-3 text-red-600">{error}</div>}
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold">Export status</h3>
          <div className="mt-3 text-sm text-muted">
            Use this tool to export a range of audit events and upload them to the audit archive. The server will ensure Object Lock and metadata are applied.
          </div>

          <div className="mt-4">
            {result ? (
              <>
                <div className="text-sm"><strong>Result:</strong></div>
                <pre className="mt-2 bg-gray-50 p-3 rounded text-sm overflow-auto">{JSON.stringify(result, null, 2)}</pre>

                {result.location && (
                  <div className="mt-3">
                    <div className="text-sm">Export location:</div>
                    <div className="font-mono mt-1 break-all">{result.location}</div>
                    <div className="mt-2 flex gap-2">
                      <button className="btn-outline" onClick={() => { navigator.clipboard?.writeText(result.location); alert('Copied'); }}>Copy</button>
                      <a className="btn-primary" href={result.location.startsWith('s3://') ? `https://s3.console.aws.amazon.com/s3/object/${result.location.replace('s3://', '')}` : result.location} target="_blank" rel="noreferrer">Open</a>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-muted">No export yet. Fill the form and click Export Audit Batch.</div>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

