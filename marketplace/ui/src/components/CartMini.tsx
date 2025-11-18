'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { SkuSummary } from '@/types';
import { formatCurrency } from '@/lib/utils/formatCurrency';

/**
 * CartMini
 *
 * Small navbar mini-cart component:
 * - Shows item count
 * - Opens a dropdown with cart items stored in localStorage (illuvrse_cart_v1)
 * - Allows removing items and navigating to full cart/checkout
 *
 * This is a lightweight client-side helper for quick UX.
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

export default function CartMini() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SkuSummary[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setItems(loadCart());
  }, []);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === CART_KEY) {
        setItems(loadCart());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick);
      return () => document.removeEventListener('mousedown', onDocClick);
    }
    return;
  }, [open]);

  function handleRemove(skuId: string) {
    const next = items.filter((i) => i.sku_id !== skuId);
    setItems(next);
    saveCart(next);
  }

  function handleClear() {
    setItems([]);
    saveCart([]);
  }

  const subtotal = items.reduce((s, it) => s + (it.price || 0), 0);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-2 btn-ghost"
        title="Cart"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
          <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l3-8H6.4M7 13l-2 6h13l-2-6M7 13l10 0"/>
        </svg>
        <span className="sr-only">Cart</span>
        <span className="text-sm hidden md:inline">Cart</span>
        <span
          className="ml-1 inline-flex items-center justify-center text-xs font-semibold rounded-full bg-[var(--illuvrse-primary)] text-white"
          style={{ minWidth: 20, height: 20 }}
        >
          {items.length}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-md shadow-illuvrse-soft p-3 z-50">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold">Cart</div>
            <div className="text-sm text-muted">{items.length} item{items.length !== 1 ? 's' : ''}</div>
          </div>

          {items.length === 0 ? (
            <div className="text-sm text-muted">Your cart is empty.</div>
          ) : (
            <div className="space-y-3 max-h-64 overflow-auto">
              {items.map((it) => (
                <div key={it.sku_id} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                  <div style={{ width: 56, height: 40 }} className="bg-white rounded overflow-hidden flex items-center justify-center">
                    {it.thumbnail ? (
                      // Use simple <img> to avoid next/image remote config for thumbnails
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.thumbnail} alt={it.title} style={{ maxWidth: '100%', maxHeight: '100%' }} />
                    ) : (
                      <div className="text-xs text-muted">No image</div>
                    )}
                  </div>

                  <div className="flex-1">
                    <div className="text-sm font-medium">{it.title}</div>
                    <div className="text-xs text-muted">{it.summary}</div>
                    <div className="mt-1 text-sm font-semibold">{formatCurrency(it.price || 0, it.currency || 'USD')}</div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <button className="btn-outline text-xs" onClick={() => (window.location.href = `/sku/${encodeURIComponent(it.sku_id)}`)}>View</button>
                    <button className="btn-ghost text-xs" onClick={() => handleRemove(it.sku_id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 border-t pt-3">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-muted">Subtotal</div>
              <div className="font-semibold">{formatCurrency(subtotal)}</div>
            </div>

            <div className="flex items-center gap-2">
              <Link href="/cart">
                <button className="btn-ghost flex-1">View Cart</button>
              </Link>
              <button
                className="btn-primary flex-1"
                onClick={() => {
                  // simple behavior: if one item, go to checkout for that sku; otherwise view cart
                  if (items.length === 1) {
                    window.location.href = `/checkout?sku=${encodeURIComponent(items[0].sku_id)}`;
                  } else {
                    window.location.href = '/cart';
                  }
                }}
              >
                Checkout
              </button>
            </div>

            <div className="mt-2 text-right">
              <button className="text-xs text-muted" onClick={handleClear}>Clear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

