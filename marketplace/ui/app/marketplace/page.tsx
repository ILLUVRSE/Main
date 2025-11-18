'use client';
import React, { useEffect, useState } from 'react';
import type { SkuSummary } from '@/types';
import * as api from '@/lib/api';
import SkuCard from '../../src/components/SkuCard';
import { PreviewProvider, usePreview } from '../../src/components/PreviewProvider';

/**
 * Marketplace catalog page — wrapped with PreviewProvider so any SkuCard can
 * open the preview modal via the `onPreview` callback.
 *
 * Note: This is a client component because it uses the preview client hook.
 */

function MarketplaceCatalogInner() {
  const [items, setItems] = useState<SkuSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);
  const pageSize = 12;

  // preview hook from the provider
  const { openPreview } = usePreview();

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
  }, [page]);

  return (
    <div>
      {/* Hero / marketing */}
      <section className="hero">
        <h1 className="text-3xl md:text-4xl lg:text-5xl font-heading font-extrabold">
          Marketplace for trusted models, proofs & licensed delivery
        </h1>
        <p className="mt-4 text-muted max-w-2xl">
          Discover Kernel-signed manifests, preview sandboxes, and buy with auditable signed proofs.
          Secure delivery, royalty-aware payouts, and verifiable licenses.
        </p>

        <div className="mt-6 flex gap-4">
          <a className="btn-primary" href="#catalog">Browse models</a>
          <a className="btn-outline" href="/docs/PRODUCTION">Read Runbook</a>
        </div>
      </section>

      {/* Catalog */}
      <section id="catalog" className="container mt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-muted">
            {loading ? 'Loading…' : `${Math.min(page * pageSize, total)} of ${total} items`}
          </div>

          <div className="flex items-center gap-3">
            <select className="text-sm border rounded-md px-3 py-1 bg-white">
              <option>All categories</option>
              <option>ML model</option>
              <option>Tool</option>
            </select>
            <button className="btn-ghost">Sort</button>
          </div>
        </div>

        {/* Grid — uses .sku-grid from globals.css */}
        <div className="sku-grid">
          {loading
            ? Array.from({ length: pageSize }).map((_, i) => (
                <div key={i} className="card h-64 animate-pulse" />
              ))
            : items.map((s) => (
                <SkuCard
                  key={s.sku_id}
                  sku={s}
                  onPreview={(skuId: string) => {
                    // open the preview modal via provider hook
                    openPreview(skuId);
                  }}
                />
              ))}
        </div>

        {/* Pagination */}
        <div className="mt-6 flex justify-center gap-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="btn-ghost"
            aria-label="Previous page"
          >
            Prev
          </button>

          <div className="text-sm text-muted">Page {page}</div>

          <button
            onClick={() => setPage((p) => p + 1)}
            className="btn-ghost"
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}

export default function MarketplacePage() {
  // Wrap the catalog with the provider here to scope preview modal to this page.
  // For app-wide access, move PreviewProvider into layout.tsx.
  return (
    <PreviewProvider>
      <MarketplaceCatalogInner />
    </PreviewProvider>
  );
}

