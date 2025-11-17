'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import api from '@/lib/api';
import type { SkuSummary } from '@/types';

/**
 * marketplace/ui/app/marketplace/page.tsx
 *
 * Simple client-side marketplace catalog page that fetches /catalog
 * and renders a responsive SKU grid. Uses the API wrapper (src/lib/api.ts).
 *
 * This is intentionally light: we render simple cards here and later replace
 * them with full SkuCard components when available.
 */

export default function MarketplacePage() {
  const [items, setItems] = useState<SkuSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);
  const [pageSize] = useState<number>(12);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api
      .getCatalog({ page, page_size: pageSize })
      .then((res) => {
        if (!mounted) return;
        setItems(res.items || []);
        setTotal(res.total || 0);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Failed to fetch catalog', err);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [page, pageSize]);

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-heading font-bold">Marketplace</h2>
          <p className="text-muted text-sm">Discover signed models, previews & licensed delivery</p>
        </div>

        <div className="text-sm text-muted">
          {loading ? 'Loading…' : `${Math.min(page * pageSize, total)} of ${total} items`}
        </div>
      </div>

      <div className="sku-grid">
        {loading
          ? // render skeleton placeholders
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="h-40 bg-gray-100 rounded-md" />
                <div className="mt-3 h-4 bg-gray-100 w-3/4 rounded" />
                <div className="mt-2 h-3 bg-gray-100 w-1/2 rounded" />
                <div className="mt-4 flex justify-between items-center">
                  <div className="h-8 w-20 bg-gray-100 rounded" />
                  <div className="h-8 w-20 bg-gray-100 rounded" />
                </div>
              </div>
            ))
          : items.map((s) => (
              <article key={s.sku_id} className="card">
                <div className="relative h-40 bg-gray-50 rounded-md overflow-hidden flex items-center justify-center">
                  {s.thumbnail ? (
                    <Image src={s.thumbnail} alt={s.title} fill style={{ objectFit: 'contain' }} />
                  ) : (
                    <div className="text-muted">No Image</div>
                  )}
                </div>

                <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                <p className="text-sm text-muted mt-1 line-clamp-2">{s.summary}</p>

                <div className="mt-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="price-pill">${(s.price / 100).toFixed(2)}</span>
                    {s.manifest_valid ? (
                      <span className="illuvrse-badge bg-green-50 text-green-700">Verified</span>
                    ) : (
                      <span className="illuvrse-badge bg-yellow-50 text-yellow-700">Unverified</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/sku/${encodeURIComponent(s.sku_id)}`}>
                      <button className="btn-outline">View</button>
                    </Link>
                    <Link href={`/checkout?sku=${encodeURIComponent(s.sku_id)}`}>
                      <button className="btn-primary">Buy</button>
                    </Link>
                  </div>
                </div>
              </article>
            ))}
      </div>

      {/* Simple pagination controls */}
      <div className="mt-8 flex items-center justify-between">
        <div className="text-sm text-muted">
          Page {page} • Showing {items.length} items
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="btn-ghost"
            disabled={page <= 1}
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            className="btn-ghost"
            disabled={page * pageSize >= total}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

