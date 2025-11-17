'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import type { Proof } from '@/types';

/**
 * Proof detail page: fetches GET /proofs/{proofId} and renders the proof,
 * canonical payload, signature, and signer metadata. Provides small helpers
 * to copy the payload or download the proof JSON for offline verification.
 */

export default function ProofPage() {
  const params = useParams() as { proofId?: string };
  const proofId = params?.proofId || '';

  const [proof, setProof] = useState<Proof | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (!proofId) throw new Error('proofId required');
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
    load();
    return () => {
      mounted = false;
    };
  }, [proofId]);

  function downloadProof() {
    if (!proof) return;
    const blob = new Blob([JSON.stringify(proof, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proof-${proof.proof_id || proofId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyPayload() {
    const payload = proof?.canonical_payload ?? proof;
    const txt = JSON.stringify(payload, null, 2);
    navigator.clipboard?.writeText(txt).then(
      () => alert('Copied payload to clipboard'),
      () => alert('Copy failed')
    );
  }

  if (loading) {
    return <div className="card">Loading proof…</div>;
  }

  if (error) {
    return <div className="text-red-600">Error: {error}</div>;
  }

  if (!proof) {
    return <div className="text-muted">Proof not found.</div>;
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-heading font-bold">Proof {proof.proof_id}</h2>
          <div className="text-sm text-muted">Signer: {proof.signer_kid || '—'}</div>
        </div>

        <div className="flex gap-3">
          <button className="btn-outline" onClick={copyPayload}>Copy payload</button>
          <button className="btn-primary" onClick={downloadProof}>Download JSON</button>
        </div>
      </div>

      <div className="card">
        <div className="mb-3">
          <strong>Artifact SHA-256:</strong> <span className="font-mono">{proof.artifact_sha256 || '—'}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted mb-2">Canonical payload</div>
            <pre className="bg-gray-50 p-3 rounded text-sm overflow-auto">{JSON.stringify(proof.canonical_payload || {}, null, 2)}</pre>
          </div>

          <div>
            <div className="text-sm text-muted mb-2">Signature & metadata</div>
            <div className="p-3 bg-gray-50 rounded text-sm">
              <div><strong>Signature (base64):</strong></div>
              <pre className="mt-2 break-all">{proof.signature || '—'}</pre>

              <div className="mt-4"><strong>Signer KID:</strong> {proof.signer_kid || '—'}</div>
              <div className="mt-2"><strong>Ledger proof id:</strong> {proof.ledger_proof_id || '—'}</div>
              <div className="mt-2"><strong>Manifest signature id:</strong> {proof.manifest_signature_id || '—'}</div>
              <div className="mt-2"><strong>Timestamp:</strong> {proof.ts || '—'}</div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h4 className="text-lg font-semibold">Verification notes</h4>
          <p className="text-sm text-muted mt-2">
            To verify this proof, obtain the public key for <code>{proof.signer_kid}</code> (from your signer registry or Kernel verifier list),
            then verify the signature over the canonical payload using the signer public key and the appropriate algorithm (e.g., RSA/SHA256 or Ed25519).
          </p>

          <div className="mt-4 text-sm">
            <strong>Suggested verification command (OpenSSL / RSA example):</strong>
            <pre className="mt-2 bg-gray-50 p-3 rounded text-sm">
{`# Save canonical payload as payload.json and signature as sig.bin (base64 decode)
openssl dgst -sha256 -verify /tmp/audit_key.pem -signature /tmp/sig.bin payload.json`}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

