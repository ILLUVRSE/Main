'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import api from '@/lib/api';
import type { SkuDetail } from '@/types';

/**
 * SKU detail page:
 * - fetches GET /sku/{id}
 * - shows hero, buy box, manifest verification, royalty summary (if present)
 * - allows starting a preview (POST /sku/{id}/preview) and opens a basic modal
 */

function PreviewModal({
  session,
  onClose,
}: {
  session: { session_id?: string; endpoint?: string; expires_at?: string } | null;
  onClose: () => void;
}) {
  if (!session) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg shadow-illuvrse-strong max-w-3xl w-full p-6">
        <div className="flex items-start justify-between">
          <h3 className="text-xl font-semibold">Preview Session</h3>
          <button onClick={onClose} className="btn-ghost">Close</button>
        </div>

        <div className="mt-4">
          <p><strong>Session ID:</strong> {session.session_id}</p>
          <p><strong>Endpoint:</strong> <code className="text-sm">{session.endpoint}</code></p>
          <p><strong>Expires at:</strong> {session.expires_at}</p>

          <div className="mt-4 flex gap-3">
            <a className="btn-primary" href={session.endpoint || '#'} target="_blank" rel="noreferrer">
              Open Preview
            </a>
            <button className="btn-outline" onClick={() => alert('Open sandbox console (dev)')}>
              Open Console
            </button>
          </div>

          <div className="mt-4 text-sm text-muted">
            The preview runs in a sandboxed environment and emits audit events. For production, ensure preview pool is secured.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SkuPageClient() {
  const params = useParams() as { skuId?: string };
  const skuId = params?.skuId || '';
  const router = useRouter();

  const [sku, setSku] = useState<SkuDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [previewSession, setPreviewSession] = useState<{ session_id?: string; endpoint?: string; expires_at?: string } | null>(null);
  const [startingPreview, setStartingPreview] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    if (!skuId) return;
    setLoading(true);
    setError(null);
    api
      .getSku(skuId)
      .then((res) => {
        if (!mounted) return;
        setSku(res.sku || null);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Failed to load SKU', err);
        if (mounted) setError(String(err?.message || 'Failed to load SKU'));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [skuId]);

  async function handleStartPreview() {
    if (!skuId) return;
    setStartingPreview(true);
    try {
      const res = await api.postPreview(skuId, { expires_in_seconds: 900 });
      setPreviewSession({
        session_id: res.session_id,
        endpoint: res.endpoint,
        expires_at: res.expires_at,
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Preview error', err);
      alert('Failed to start preview: ' + (err?.message || 'Unknown'));
    } finally {
      setStartingPreview(false);
    }
  }

  if (loading) {
    return (
      <section>
        <div className="card">
          <div className="h-64 bg-gray-100 animate-pulse" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section>
        <div className="text-red-600">Error loading SKU: {error}</div>
      </section>
    );
  }

  if (!sku) {
    return (
      <section>
        <div className="text-muted">SKU not found.</div>
      </section>
    );
  }

  return (
    <section>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: hero */}
        <div className="lg:col-span-2 card">
          <div className="relative h-72 bg-gray-50 rounded-md overflow-hidden flex items-center justify-center">
            {sku.manifest_metadata?.metadata?.thumbnail || sku.manifest_metadata?.metadata?.image ? (
              <Image
                src={sku.manifest_metadata?.metadata?.thumbnail || sku.manifest_metadata?.metadata?.image}
                alt={sku.title}
                fill
                style={{ objectFit: 'contain' }}
              />
            ) : (
              <div className="text-muted">No image available</div>
            )}
          </div>

          <div className="mt-4">
            <h1 className="text-3xl font-heading font-bold">{sku.title}</h1>
            <p className="text-muted mt-2">{sku.description}</p>

            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-2">Manifest</h3>
              <div className="p-3 border rounded-md">
                {sku.manifest && (sku.manifest as any).manifest_signature ? (
                  <div className="flex items-center gap-3">
                    <div className="illuvrse-badge bg-green-50 text-green-700">Kernel Signed</div>
                    <div className="text-sm text-muted">
                      signer: {(sku.manifest as any).manifest_signature.signer_kid} • signed at{' '}
                      {(sku.manifest as any).manifest_signature.ts}
                    </div>
                  </div>
                ) : sku.manifest_valid ? (
                  <div className="illuvrse-badge bg-green-50 text-green-700">Manifest Valid</div>
                ) : (
                  <div className="illuvrse-badge bg-yellow-50 text-yellow-700">Manifest Not Validated</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Buy box */}
        <aside className="card">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-muted text-sm">Price</div>
                <div className="mt-1">
                  <span className="price-pill">${(sku.price / 100).toFixed(2)}</span>
                </div>
              </div>

              <div>
                {/* royalty hint (if any) */}
                <div className="text-sm text-muted">Royalties</div>
                <div className="mt-1 text-sm">{/* placeholder */}—</div>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <button className="btn-primary w-full" onClick={() => router.push(`/checkout?sku=${encodeURIComponent(sku.sku_id)}`)}>
                Buy
              </button>

              <button className="btn-outline w-full" onClick={handleStartPreview} disabled={startingPreview}>
                {startingPreview ? 'Starting preview…' : 'Start Preview'}
              </button>

              <button
                className="btn-ghost w-full"
                onClick={() => {
                  // operator-only: open manifest modal or download
                  alert('Manifest download / view (operator only)');
                }}
              >
                View Manifest
              </button>
            </div>

            <div className="mt-4 text-sm text-muted">
              <div>SKU ID: {sku.sku_id}</div>
              <div>Author: {sku.author_id || '—'}</div>
            </div>
          </div>
        </aside>
      </div>

      {/* Additional area: description, license terms, reviews placeholder */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <h3 className="text-xl font-semibold mb-3">Details</h3>
          <div className="prose">
            <p>{sku.description}</p>
            {/* Show manifest metadata if available */}
            {sku.manifest_metadata && (
              <pre className="mt-4 bg-gray-50 p-3 rounded text-sm overflow-auto">
                {JSON.stringify(sku.manifest_metadata, null, 2)}
              </pre>
            )}
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold">License summary</h3>
          <div className="mt-2 text-sm text-muted">
            {/* If manifest contains license summary, show it */}
            {sku.manifest?.license?.type ? (
              <>
                <div><strong>Type:</strong> {(sku.manifest as any).license.type}</div>
                <div className="mt-2">{(sku.manifest as any).license.terms || 'No terms provided'}</div>
              </>
            ) : (
              <div>No license metadata available</div>
            )}
          </div>
        </div>
      </div>

      {/* Preview modal */}
      <PreviewModal
        session={previewSession}
        onClose={() => setPreviewSession(null)}
      />
    </section>
  );
}

