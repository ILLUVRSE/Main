'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import type { SkuSummary } from '@/types';
import { formatCurrency } from '@/lib/utils/formatCurrency';

/**
 * Simple Cart page backed by localStorage.
 *
 * - Cart items are stored under key "illuvrse_cart_v1" as an array of SkuSummary.
 * - You can remove items and proceed to checkout; if a single SKU is present the
 *   checkout page will be opened with ?sku=...; for multiple items the page will
 *   show a message and allow checkout of the first item (dev simplicity).
 *
 * Note: In production you will want server-side persistent carts, user-linked carts,
 * and a proper multi-item checkout API.
 */

const CART_KEY = 'illuvrse_cart_v1';

function loadCart(): SkuSummary[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(CART_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SkuSummary[];
  } catch {
    return [];
  }
}

function saveCart(items: SkuSummary[]) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

export default function CartPage() {
  const [items, setItems] = useState<SkuSummary[]>([]);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(loadCart());
  }, []);

  async function handleRemove(skuId: string) {
    const next = items.filter((i) => i.sku_id !== skuId);
    setItems(next);
    saveCart(next);
  }

  function handleClear() {
    setItems([]);
    saveCart([]);
  }

  function handleCheckout() {
    if (items.length === 0) {
      alert('Cart is empty');
      return;
    }
    if (items.length === 1) {
      // Checkout for single SKU: redirect to /checkout?sku=...
      window.location.href = `/checkout?sku=${encodeURIComponent(items[0].sku_id)}`;
      return;
    }
    // Simple dev behavior: inform user and redirect to checkout with first SKU
    if (
      confirm(
        `Cart has ${items.length} items. Multi-item checkout not implemented in this demo. Checkout the first item (${items[0].title})?`
      )
    ) {
      window.location.href = `/checkout?sku=${encodeURIComponent(items[0].sku_id)}`;
    }
  }

  async function refreshPrices() {
    setLoadingPrices(true);
    setError(null);
    try {
      // Try to refresh each SKU from GET /sku/{id} to get the latest price/valid flag
      const refreshed: SkuSummary[] = [];
      for (const it of items) {
        try {
          const res = await api.getSku(it.sku_id);
          const s = res.sku as any;
          // Map to SkuSummary shape (best-effort)
          refreshed.push({
            sku_id: s.sku_id || it.sku_id,
            title: s.title || it.title,
            summary: s.description || it.summary,
            price: s.price ?? it.price,
            currency: s.currency ?? it.currency ?? 'USD',
            manifest_valid: s.manifest?.manifest_signature ? true : s.manifest_valid ?? it.manifest_valid,
            thumbnail: (s.manifest_metadata && (s.manifest_metadata.metadata?.thumbnail || s.manifest_metadata.metadata?.image)) || it.thumbnail,
            tags: s.tags || it.tags,
            author_id: s.author_id || it.author_id,
          });
        } catch (e) {
          // fallback to existing item if fetch fails
          refreshed.push(it);
        }
      }
      setItems(refreshed);
      saveCart(refreshed);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Failed to refresh prices', err);
      setError(String(err?.message || 'Failed to refresh'));
    } finally {
      setLoadingPrices(false);
    }
  }

  const subtotal = items.reduce((s, it) => s + (it.price || 0), 0);

  return (
    <section>
      <h2 className="text-2xl font-heading font-bold mb-3">Cart</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          {items.length === 0 ? (
            <div className="text-muted">Your cart is empty. Browse the <Link href="/marketplace" className="text-[var(--illuvrse-primary)]">marketplace</Link>.</div>
          ) : (
            <>
              <div className="space-y-4">
                {items.map((it) => (
                  <div key={it.sku_id} className="p-3 bg-gray-50 rounded flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div style={{ width: 72, height: 48 }} className="bg-white rounded overflow-hidden flex items-center justify-center">
                        {it.thumbnail ? (
                          // Note: When using next/image, ensure the host is allowed in next.config.js
                          // For small preview we render an <img> to keep it simple.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.thumbnail} alt={it.title} style={{ maxWidth: '100%', maxHeight: '100%' }} />
                        ) : (
                          <div className="text-xs text-muted">No image</div>
                        )}
                      </div>
                      <div>
                        <div className="font-medium">{it.title}</div>
                        <div className="text-sm text-muted">{it.summary}</div>
                        <div className="mt-1 text-xs text-muted">SKU: {it.sku_id}</div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <div className="font-semibold">{formatCurrency(it.price || 0, it.currency || 'USD')}</div>
                      <div className="flex items-center gap-2">
                        <button className="btn-ghost text-sm" onClick={() => window.location.href = `/sku/${encodeURIComponent(it.sku_id)}`}>View</button>
                        <button className="btn-outline text-sm" onClick={() => handleRemove(it.sku_id)}>Remove</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <button className="btn-ghost mr-3" onClick={refreshPrices} disabled={loadingPrices}>
                    {loadingPrices ? 'Refreshing…' : 'Refresh prices'}
                  </button>
                  <button className="btn-ghost" onClick={handleClear}>Clear cart</button>
                </div>

                <div className="text-sm text-muted">
                  <div>Subtotal: <strong>{formatCurrency(subtotal)}</strong></div>
                  <div className="mt-2">
                    <button className="btn-primary" onClick={handleCheckout}>Proceed to checkout</button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <aside className="card">
          <h3 className="text-lg font-semibold">Summary</h3>
          <div className="mt-3 text-sm text-muted">
            <div><strong>Items:</strong> {items.length}</div>
            <div className="mt-2"><strong>Subtotal:</strong> {formatCurrency(subtotal)}</div>
            <div className="mt-3 text-xs text-muted">Taxes, shipping and delivery options are handled during checkout.</div>
          </div>
        </aside>
      </div>
    </section>
  );
}

