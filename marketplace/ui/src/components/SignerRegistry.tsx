'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import clsx from 'clsx';

/**
 * SignerRegistry
 *
 * Admin UI for listing and adding signer public keys.
 * - Fetches GET /admin/signers (expects JSON { ok:true, signers: [...] })
 * - Adds signer via POST /admin/signers with body { signer_kid, public_key_pem }
 *
 * NOTE: This component expects the server to implement /admin/signers and enforce operator auth.
 * If your server provides a different route, adapt the fetch URLs accordingly.
 */

type Signer = {
  signer_kid: string;
  public_key_pem?: string;
  deployedAt?: string;
  comment?: string;
};

export default function SignerRegistry() {
  const { token, isOperator } = useAuth();
  const [signers, setSigners] = useState<Signer[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Add signer form state
  const [kid, setKid] = useState('');
  const [pem, setPem] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOperator()) {
      setLoading(false);
      return;
    }
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/admin/signers', { headers });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `Failed to fetch signers (${res.status})`);
        }
        const json = await res.json();
        if (mounted) setSigners(json.signers || []);
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error('Failed to load signers', err);
        if (mounted) setError(err?.message || 'Failed to load signers');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [token, isOperator]);

  async function handleAddSigner(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError(null);
    if (!kid || !pem) {
      setError('Signer KID and public key PEM are required.');
      return;
    }
    setSubmitting(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const body = { signer_kid: kid, public_key_pem: pem, comment: comment || undefined };
      const res = await fetch('/admin/signers', { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `Add signer failed (${res.status})`);
      }
      const json = await res.json();
      // Expect json.signer or full list returned
      if (json.signer) {
        setSigners((s) => [json.signer, ...s]);
      } else {
        // reload list
        setSigners(json.signers || []);
      }
      // clear form
      setKid('');
      setPem('');
      setComment('');
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Add signer failed', err);
      setError(err?.message || 'Add signer failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveSigner(signerKid: string) {
    if (!confirm(`Remove signer ${signerKid}? This is destructive.`)) return;
    setError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/admin/signers/${encodeURIComponent(signerKid)}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `Remove signer failed (${res.status})`);
      }
      // remove locally
      setSigners((s) => s.filter((x) => x.signer_kid !== signerKid));
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Remove signer failed', err);
      setError(err?.message || 'Remove signer failed');
    }
  }

  if (!isOperator()) {
    return (
      <div className="card">
        <div className="text-sm text-muted">Operator access required to manage signers.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="card mb-4">
        <h3 className="text-lg font-semibold">Signer registry</h3>
        <div className="mt-2 text-sm text-muted">
          Register public keys for signers used by Kernel / ArtifactPublisher / Audit writers.
        </div>

        <div className="mt-4">
          {loading ? (
            <div className="text-sm text-muted">Loading signers…</div>
          ) : (
            <>
              {error && <div className="text-red-600 mb-3">{error}</div>}
              <div className="space-y-3">
                {signers.length === 0 && <div className="text-muted">No signers registered.</div>}
                {signers.map((s) => (
                  <div key={s.signer_kid} className="p-3 bg-gray-50 rounded flex items-start justify-between">
                    <div>
                      <div className="font-medium">{s.signer_kid}</div>
                      <div className="text-sm text-muted mt-1">{s.comment || ''}</div>
                      <div className="mt-2 text-xs font-mono break-all">{(s.public_key_pem || '').slice(0, 200)}</div>
                      <div className="mt-2 text-xs text-muted">Deployed: {s.deployedAt || '—'}</div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <button className="btn-ghost" onClick={() => {
                        // copy full pem
                        try {
                          navigator.clipboard?.writeText(s.public_key_pem || '');
                          alert('Public key copied to clipboard');
                        } catch {
                          alert('Copy failed');
                        }
                      }}>
                        Copy PEM
                      </button>

                      <button className="btn-outline" onClick={() => handleRemoveSigner(s.signer_kid)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <form className="card" onSubmit={handleAddSigner}>
        <h4 className="text-lg font-semibold">Add new signer</h4>
        <div className="mt-3 text-sm text-muted">Provide a signer KID and the public key PEM. The server will persist and optionally publish it to Kernel registry.</div>

        <div className="mt-3 grid grid-cols-1 gap-3">
          <label>
            <div className="text-sm">Signer KID</div>
            <input value={kid} onChange={(e) => setKid(e.target.value)} className="mt-1 block w-full rounded-md border px-3 py-2" placeholder="artifact-publisher-signer-v1" />
          </label>

          <label>
            <div className="text-sm">Public key (PEM)</div>
            <textarea value={pem} onChange={(e) => setPem(e.target.value)} rows={6} className="mt-1 block w-full rounded-md border p-2 font-mono text-sm" placeholder="-----BEGIN PUBLIC KEY-----..." />
          </label>

          <label>
            <div className="text-sm">Comment (optional)</div>
            <input value={comment} onChange={(e) => setComment(e.target.value)} className="mt-1 block w-full rounded-md border px-3 py-2" />
          </label>

          <div className="flex gap-3">
            <button className="btn-primary" type="submit" disabled={submitting}>{submitting ? 'Adding…' : 'Add signer'}</button>
            <button type="button" className="btn-ghost" onClick={() => { setKid(''); setPem(''); setComment(''); }}>
              Clear
            </button>
          </div>

          {error && <div className="mt-2 text-red-600">{error}</div>}
        </div>
      </form>
    </div>
  );
}

