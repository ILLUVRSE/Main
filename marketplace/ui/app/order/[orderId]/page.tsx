'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import type { OrderRecord, Proof, License } from '@/types';

/**
 * marketplace/ui/app/order/[orderId]/page.tsx
 *
 * Fetches GET /order/{id} and renders order details, license and delivery/proof inspector.
 * Allows verifying the license (`POST /license/verify`) and fetching/verifying proof (`GET /proofs/{id}`).
 *
 * This page is intentionally pragmatic: it shows key fields and provides verification actions.
 */

function ProofCard({ proof }: { proof: Proof }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card mb-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted">Proof ID</div>
          <div className="font-medium">{proof.proof_id}</div>
          <div className="text-sm text-muted mt-2">Signer: {proof.signer_kid || '—'}</div>
        </div>

        <div className="text-right">
          <div className="text-sm text-muted">Timestamp</div>
          <div className="font-medium">{proof.ts || '—'}</div>
        </div>
      </div>

      <div className="mt-4 flex gap-3 items-center">
        <button className="btn-outline" onClick={() => setExpanded((s) => !s)}>
          {expanded ? 'Hide payload' : 'Show payload'}
        </button>
        <a
          className="btn-primary"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            // allow user to copy canonical payload
            const txt = JSON.stringify(proof.canonical_payload || proof, null, 2);
            navigator.clipboard?.writeText(txt).then(
              () => alert('Proof payload copied to clipboard (dev)'),
              () => alert('Copy failed')
            );
          }}
        >
          Copy payload
        </a>
      </div>

      {expanded && (
        <pre className="mt-4 bg-gray-50 p-3 rounded text-sm overflow-auto">
          {JSON.stringify(proof.canonical_payload || proof, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function OrderPage() {
  const params = useParams() as { orderId?: string };
  const orderId = params?.orderId || '';

  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [proof, setProof] = useState<Proof | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);

  const [verifyResult, setVerifyResult] = useState<{ verified: boolean; details?: any } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [license, setLicense] = useState<License | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (!orderId) {
          throw new Error('orderId required');
        }
        const res = await api.getOrder(orderId);
        if (!mounted) return;
        setOrder(res.order ?? null);
        setLicense((res.order && res.order.license) || null);
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error('Failed to fetch order', err);
        if (mounted) setError(err?.message || 'Failed to fetch order');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [orderId]);

  async function handleFetchProof(proofId?: string) {
    if (!proofId) {
      setProofError('No proof id provided');
      return;
    }
    setProofLoading(true);
    setProofError(null);
    try {
      const res = await api.getProof(proofId);
      setProof(res.proof);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch proof', err);
      setProofError(err?.message || 'Failed to fetch proof');
    } finally {
      setProofLoading(false);
    }
  }

  async function handleVerifyLicense() {
    if (!license) {
      setVerifyResult({ verified: false, details: 'No license to verify' });
      return;
    }
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await api.postLicenseVerify(license, order?.buyer_id);
      setVerifyResult({ verified: res.verified, details: res.details });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('License verify failed', err);
      setVerifyResult({ verified: false, details: err?.message || 'Verify failed' });
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return <div className="card">Loading order…</div>;
  }

  if (error) {
    return <div className="text-red-600">Error: {error}</div>;
  }

  if (!order) {
    return <div className="text-muted">Order not found.</div>;
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-heading font-bold">Order {order.order_id}</h2>
          <div className="text-sm text-muted">Status: <strong>{order.status}</strong></div>
        </div>

        <div className="text-sm text-muted">
          Amount: <strong>${(order.amount / 100).toFixed(2)} {order.currency}</strong>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <h3 className="text-lg font-semibold">Order details</h3>
          <div className="mt-3 text-sm text-muted">
            <div><strong>Buyer:</strong> {order.buyer_id}</div>
            <div><strong>SKU:</strong> {order.sku_id}</div>
            <div><strong>Created:</strong> {order.created_at}</div>
            <div className="mt-3">
              <strong>Payment</strong>
              <pre className="mt-2 bg-gray-50 p-3 rounded text-sm overflow-auto">{JSON.stringify(order.payment || {}, null, 2)}</pre>
            </div>
          </div>

          <div className="mt-6">
            <h4 className="font-semibold">Delivery</h4>
            {order.delivery ? (
              <div className="mt-2">
                <div><strong>Delivery ID:</strong> {order.delivery.delivery_id}</div>
                <div><strong>Status:</strong> {order.delivery.status}</div>
                <div className="mt-2">
                  <strong>Encrypted URL:</strong>
                  <div className="text-sm break-all">{order.delivery.encrypted_delivery_url}</div>
                </div>

                <div className="mt-4">
                  <strong>Proof:</strong>
                  <div className="mt-2 flex gap-3">
                    <button
                      className="btn-outline"
                      onClick={() => handleFetchProof(order.delivery?.proof_id || order.delivery?.proof?.proof_id)}
                      disabled={proofLoading}
                    >
                      {proofLoading ? 'Fetching proof…' : 'Fetch proof'}
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        alert('Open encrypted URL in a secure viewer (dev)');
                      }}
                    >
                      Open delivery
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-muted mt-2">No delivery recorded yet.</div>
            )}
          </div>
        </div>

        <aside className="card">
          <h3 className="text-lg font-semibold">License</h3>
          <div className="mt-3">
            {order.license ? (
              <>
                <div className="text-sm"><strong>License ID:</strong> {order.license.license_id}</div>
                <div className="mt-2 text-sm">
                  <strong>Scope:</strong> {JSON.stringify(order.license.scope || {}, null, 2)}
                </div>

                <div className="mt-4">
                  <button className="btn-primary w-full" onClick={handleVerifyLicense} disabled={verifying}>
                    {verifying ? 'Verifying…' : 'Verify license'}
                  </button>
                </div>

                {verifyResult && (
                  <div className={`mt-4 p-3 rounded ${verifyResult.verified ? 'proof-success' : 'bg-yellow-50'}`}>
                    <div className="font-medium">{verifyResult.verified ? 'Verified' : 'Not verified'}</div>
                    <pre className="mt-2 text-sm overflow-auto">{JSON.stringify(verifyResult.details, null, 2)}</pre>
                  </div>
                )}

                <div className="mt-4">
                  <strong>Raw license:</strong>
                  <pre className="mt-2 bg-gray-50 p-3 rounded text-sm overflow-auto">{JSON.stringify(order.license, null, 2)}</pre>
                </div>
              </>
            ) : (
              <div className="text-muted">No license issued yet.</div>
            )}
          </div>
        </aside>
      </div>

      {/* Proof inspector */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-3">Proof inspector</h3>
        {proofError && <div className="text-red-600 mb-3">{proofError}</div>}
        {proof ? <ProofCard proof={proof} /> : <div className="text-muted">No proof loaded.</div>}
      </div>
    </section>
  );
}

