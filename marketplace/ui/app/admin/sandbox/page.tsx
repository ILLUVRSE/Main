'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';

/**
 * Admin Sandbox page
 *
 * - Lists preview sandbox pool configuration and active sessions.
 * - Allows operators to stop a session or trigger a pool reap.
 * - Uses /admin/sandbox endpoints (server must implement these and enforce operator auth).
 *
 * Note: This is a pragmatic admin UI for development and ops. In production,
 * ensure the endpoints are protected and actions are audited.
 */

type SandboxSession = {
  session_id: string;
  sku_id?: string;
  endpoint?: string;
  started_at?: string;
  expires_at?: string;
  status?: string; // running | expired | failed | completed
  actor_id?: string;
  metadata?: any;
};

type SandboxPool = {
  pool_size: number;
  cpu_millis: number;
  memory_mb: number;
  ttl_seconds: number;
  last_reap?: string;
};

export default function AdminSandboxPage() {
  const { isOperator, token } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SandboxSession[]>([]);
  const [pool, setPool] = useState<SandboxPool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reaping, setReaping] = useState(false);

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

      const [poolRes, sessionsRes] = await Promise.all([
        fetch('/admin/sandbox/pool', { headers }),
        fetch('/admin/sandbox/sessions', { headers }),
      ]);

      if (!poolRes.ok) throw new Error(`Pool fetch failed (${poolRes.status})`);
      if (!sessionsRes.ok) throw new Error(`Sessions fetch failed (${sessionsRes.status})`);

      const poolJson = await poolRes.json();
      const sessionsJson = await sessionsRes.json();

      setPool(poolJson.pool || null);
      setSessions(sessionsJson.sessions || []);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch sandbox data', err);
      setError(err?.message || 'Failed to fetch sandbox state');
    } finally {
      setLoading(false);
    }
  }

  async function handleStopSession(sessionId: string) {
    if (!confirm(`Stop session ${sessionId}?`)) return;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/admin/sandbox/sessions/${encodeURIComponent(sessionId)}/stop`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `Stop failed (${res.status})`);
      }
      toast.push({ message: `Session ${sessionId} stopped`, level: 'success' });
      fetchData();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Stop session failed', err);
      toast.push({ message: `Stop failed: ${String(err?.message || err)}`, level: 'error' });
    }
  }

  async function handleReapPool() {
    if (!confirm('Trigger pool reap (reap expired sessions)?')) return;
    setReaping(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/admin/sandbox/reap', { method: 'POST', headers });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `Reap failed (${res.status})`);
      }
      const json = await res.json();
      toast.push({ message: `Reap completed: ${JSON.stringify(json, null, 0)}`, level: 'success', durationMs: 7000 });
      fetchData();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Reap failed', err);
      toast.push({ message: `Reap failed: ${String(err?.message || err)}`, level: 'error' });
    } finally {
      setReaping(false);
    }
  }

  if (!isOperator()) {
    return (
      <div className="card">
        <div className="text-sm text-muted">Operator access required to view sandbox admin.</div>
      </div>
    );
  }

  return (
    <section>
      <h2 className="text-2xl font-heading font-bold mb-3">Sandbox Pool & Sessions</h2>

      {loading ? (
        <div className="card">Loading…</div>
      ) : error ? (
        <div className="card text-red-600">Error: {error}</div>
      ) : (
        <>
          <div className="card mb-4">
            <h3 className="text-lg font-semibold">Pool configuration</h3>
            {pool ? (
              <div className="mt-3 text-sm text-muted">
                <div><strong>Pool size:</strong> {pool.pool_size}</div>
                <div><strong>CPU (ms):</strong> {pool.cpu_millis}</div>
                <div><strong>Memory (MB):</strong> {pool.memory_mb}</div>
                <div><strong>TTL (s):</strong> {pool.ttl_seconds}</div>
                <div><strong>Last reap:</strong> {pool.last_reap || '—'}</div>
              </div>
            ) : (
              <div className="text-muted">No pool configuration found.</div>
            )}

            <div className="mt-4">
              <button className="btn-outline mr-3" onClick={() => { fetchData(); }}>
                Refresh
              </button>
              <button className="btn-primary" onClick={handleReapPool} disabled={reaping}>
                {reaping ? 'Reaping…' : 'Trigger Reap'}
              </button>
            </div>
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold">Active sessions ({sessions.length})</h3>

            <div className="mt-3 space-y-3">
              {sessions.length === 0 && <div className="text-muted">No active sessions</div>}
              {sessions.map((s) => (
                <div key={s.session_id} className="p-3 bg-gray-50 rounded flex items-start justify-between">
                  <div>
                    <div className="font-medium">{s.session_id}</div>
                    <div className="text-sm text-muted mt-1">
                      SKU: {s.sku_id || '—'} • Status: {s.status || '—'} • Started: {s.started_at || '—'}
                    </div>
                    <div className="mt-2 text-xs font-mono break-all">{s.endpoint}</div>
                    <div className="mt-2 text-sm text-muted">Actor: {s.actor_id || 'system'}</div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button className="btn-outline" onClick={() => handleStopSession(s.session_id)}>Stop</button>
                    <button className="btn-ghost" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(s, null, 2)); alert('Session copied'); }}>
                      Copy
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

