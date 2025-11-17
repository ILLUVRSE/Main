'use client';

import React, { useEffect, useState } from 'react';
import api from '@/lib/api';
import type { Proof } from '@/types';
import clsx from 'clsx';

/**
 * ProofInspector
 *
 * Reusable component that accepts either a `proofId` (string) or a `proof` object.
 * If `proofId` is provided, it will fetch GET /proofs/{proofId}.
 * Renders canonical payload, signature metadata and exposes verify/copy/download actions.
 *
 * Props:
 *  - proofId?: string
 *  - proof?: Proof
 *  - showControls?: boolean (defaults to true) -- show copy/download/verify
 *  - className?: string
 *  - onVerified?: (res) => void
 */

type Props = {
  proofId?: string;
  proof?: Proof | null;
  showControls?: boolean;
  className?: string;
  onVerified?: (res: { verified: boolean; details?: any }) => void;
};

export default function ProofInspector({ proofId, proof: initialProof = null, showControls = true, className, onVerified }: Props) {
  const [proof, setProof] = useState<Proof | null>(initialProof);
  const [loading, setLoading] = useState<boolean>(!Boolean(initialProof));
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [verifyResult, setVerifyResult] = useState<{ verified: boolean; details?: any } | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!proofId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await api.getProof(proofId);
        if (!mounted) return;
        setProof(res.proof || null);
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error('Failed to fetch proof', err);
        if (mounted) setError(err?.message || 'Failed to fetch proof');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    // Only fetch if we don't have an initial proof or proofId differs from initial proof id
    if (!initialProof || (proofId && initialProof.proof_id !== proofId)) {
      load();
    } else {
      setLoading(false);
    }
    return () => {
      mounted = false;
    };
  }, [proofId, initialProof]);

  async function handleCopyPayload() {
    try {
      const payload = proof?.canonical_payload ?? proof ?? {};
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      // eslint-disable-next-line no-alert
      alert('Canonical payload copied to clipboard.');
    } catch {
      // eslint-disable-next-line no-alert
      alert('Copy failed');
    }
  }

  function handleDownload() {
    if (!proof) return;
    const blob = new Blob([JSON.stringify(proof, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proof-${proof.proof_id || 'unknown'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleVerify() {
    if (!proof) {
      setVerifyResult({ verified: false, details: 'No proof to verify' });
      return;
    }
    setVerifying(true);
    setVerifyResult(null);
    try {
      // For proof verification we rely on license verification endpoint only for licenses.
      // For proofs we expect a server-side verification endpoint; if none exists, we return a best-effort response.
      // Here we attempt to call `POST /license/verify` if canonical_payload looks like a license,
      // otherwise we surface the proof object for operator verification.
      // Implementers should replace this with a dedicated `/proofs/{id}/verify` server endpoint.
      const maybeLicense = (proof.canonical_payload && (proof.canonical_payload as any).license) ? (proof.canonical_payload as any).license : null;

      if (maybeLicense) {
        // Use license verification API path to verify the inner license
        const resp = await api.postLicenseVerify(maybeLicense, undefined);
        const out = { verified: Boolean(resp.verified), details: resp.details };
        setVerifyResult(out);
        onVerified?.(out);
      } else {
        // No license found — fallback: attempt to verify by calling server-side proof fetch endpoint (server may provide verification)
        // Try `GET /proofs/{id}` returned object may include `verified` metadata in some deployments.
        const res = await api.getProof(proof.proof_id);
        const p = res.proof as Proof;
        // If server provided verification info, use it; otherwise return canonical payload presence as "not verified"
        const verifiedInfo = (p as any).verified ? { verified: true, details: (p as any).verified } : { verified: false, details: 'Server did not return verification info; perform offline verification with signer public key' };
        setVerifyResult(verifiedInfo);
        onVerified?.(verifiedInfo);
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Verify failed', err);
      setVerifyResult({ verified: false, details: err?.message || 'Verification failed' });
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return <div className="card">Loading proof…</div>;
  }

  if (error) {
    return <div className="card text-red-600">Error: {error}</div>;
  }

  if (!proof) {
    return <div className={clsx('card text-muted', className)}>No proof available.</div>;
  }

  return (
    <div className={clsx('space-y-4', className)}>
      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-muted">Proof ID</div>
            <div className="font-medium">{proof.proof_id}</div>
            <div className="text-xs text-muted mt-1">Signer: {proof.signer_kid || '—'}</div>
          </div>

          <div className="text-right">
            <div className="text-sm text-muted">Timestamp</div>
            <div className="font-mono text-sm">{proof.ts || '—'}</div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm text-muted">Artifact SHA-256</div>
          <div className="font-mono mt-1 break-all">{proof.artifact_sha256 || '—'}</div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted">Canonical payload</div>
            <pre className="mt-2 bg-gray-50 p-3 rounded text-sm overflow-auto">{JSON.stringify(proof.canonical_payload || {}, null, 2)}</pre>
          </div>

          <div>
            <div className="text-sm text-muted">Signature & metadata</div>
            <div className="mt-2 bg-gray-50 p-3 rounded text-sm">
              <div><strong>Signature (base64):</strong></div>
              <pre className="mt-2 break-all">{proof.signature || '—'}</pre>

              <div className="mt-3"><strong>Signer KID:</strong> {proof.signer_kid || '—'}</div>
              <div className="mt-2"><strong>Ledger proof id:</strong> {proof.ledger_proof_id || '—'}</div>
              <div className="mt-2"><strong>Manifest signature id:</strong> {proof.manifest_signature_id || '—'}</div>
            </div>
          </div>
        </div>

        {showControls && (
          <div className="mt-4 flex items-center gap-3">
            <button className="btn-outline" onClick={handleCopyPayload}>Copy payload</button>
            <button className="btn-primary" onClick={handleDownload}>Download JSON</button>
            <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(JSON.stringify(proof, null, 2)) && alert('Proof copied')}>
              Copy full proof
            </button>

            <div className="ml-auto">
              <button className="btn-primary" onClick={handleVerify} disabled={verifying}>
                {verifying ? 'Verifying…' : 'Verify proof'}
              </button>
            </div>
          </div>
        )}

        {verifyResult && (
          <div className={clsx('mt-4 p-3 rounded', verifyResult.verified ? 'proof-success' : 'bg-yellow-50')}>
            <div className="font-semibold">{verifyResult.verified ? 'Verified' : 'Verification result'}</div>
            <pre className="mt-2 text-sm overflow-auto">{JSON.stringify(verifyResult.details || {}, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

