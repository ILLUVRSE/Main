'use client';

import React from 'react';
import type { SkuDetail } from '@/types';

type Props = {
  sku: SkuDetail;
  onBuy: (opts?: { buyerId?: string }) => Promise<void> | void;
  onPreview?: () => Promise<void> | void;
  disabled?: boolean;
};

/**
 * BuyBox component:
 * - Shows price, royalty hint and primary actions (Buy / Preview).
 * - Accepts handlers for onBuy and onPreview.
 * - Designed to be visually consistent with the brand tokens and Buy Box patterns.
 */

export default function BuyBox({ sku, onBuy, onPreview, disabled = false }: Props) {
  const price = (sku?.price ?? 0) / 100;

  // Compute royalty hint if manifest_metadata contains royalty rules (best-effort)
  const royaltyHint = (() => {
    try {
      // manifest_metadata might contain royalty info under metadata.royalties or similar.
      const r = (sku.manifest_metadata as any)?.metadata?.royalties || (sku as any)?.manifest_metadata?.royalties;
      if (!r) return null;
      // r could be { type: 'percentage', splits: [{recipient, percentage}, ...] }
      if (r.type === 'percentage' && Array.isArray(r.splits)) {
        return `${r.splits.map((s: any) => `${s.percentage}%→${String(s.recipient).replace('actor:', '')}`).join(', ')}`;
      }
      return null;
    } catch {
      return null;
    }
  })();

  return (
    <aside className="card">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted">Price</div>
            <div className="mt-1">
              <span className="price-pill">${price.toFixed(2)}</span>
            </div>
          </div>

          <div className="text-right">
            <div className="text-sm text-muted">SKU</div>
            <div className="font-mono text-sm mt-1">{sku.sku_id}</div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm text-muted">Royalties</div>
          <div className="mt-2 text-sm">
            {royaltyHint ? (
              <div>{royaltyHint}</div>
            ) : (
              <div className="text-muted">No royalty rule or not published</div>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <button
            className="btn-primary w-full"
            onClick={() => onBuy?.()}
            disabled={disabled}
            aria-label="Buy now"
          >
            Buy
          </button>

          <button
            className="btn-outline w-full"
            onClick={() => onPreview?.()}
            disabled={disabled}
            aria-label="Start preview"
          >
            Preview
          </button>

          <button
            className="btn-ghost w-full"
            onClick={() => {
              // Quick support/FAQ link (could open a modal)
              alert('Open support / FAQ (dev)');
            }}
          >
            Support & FAQs
          </button>
        </div>

        <div className="mt-4 text-sm text-muted">
          <div>
            <strong>Manifest:</strong>{' '}
            {sku.manifest_valid ? (
              <span className="illuvrse-badge bg-green-50 text-green-700">Verified</span>
            ) : (
              <span className="illuvrse-badge bg-yellow-50 text-yellow-700">Not verified</span>
            )}
          </div>

          {sku.manifest_signature_id && (
            <div className="mt-2 text-xs text-muted">
              Manifest signature: <span className="font-mono">{sku.manifest_signature_id}</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

