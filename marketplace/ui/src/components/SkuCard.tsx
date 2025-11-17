'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { SkuSummary } from '@/types';

type Props = {
  sku: SkuSummary;
  onPreview?: (skuId: string) => void;
};

/**
 * Reusable SKU card used on catalog and other listings.
 * - Shows thumbnail, title, summary, price, verification badge and actions.
 * - `onPreview` can be provided to start a preview modal from the parent.
 */

export default function SkuCard({ sku, onPreview }: Props) {
  return (
    <article className="card flex flex-col">
      <div className="relative h-44 bg-gray-50 rounded-md overflow-hidden flex items-center justify-center">
        {sku.thumbnail ? (
          <Image src={sku.thumbnail} alt={sku.title} fill style={{ objectFit: 'contain' }} />
        ) : (
          <div className="text-muted">No image</div>
        )}
      </div>

      <div className="mt-3 flex-1">
        <h3 className="text-lg font-semibold">{sku.title}</h3>
        <p className="text-sm text-muted mt-1 line-clamp-3">{sku.summary}</p>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="price-pill">${(sku.price / 100).toFixed(2)}</span>
          {sku.manifest_valid ? (
            <span className="illuvrse-badge bg-green-50 text-green-700">Verified</span>
          ) : (
            <span className="illuvrse-badge bg-yellow-50 text-yellow-700">Unverified</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            className="btn-outline text-sm"
            onClick={() => (onPreview ? onPreview(sku.sku_id) : undefined)}
            title="Preview"
          >
            Preview
          </button>

          <Link href={`/checkout?sku=${encodeURIComponent(sku.sku_id)}`}>
            <button className="btn-primary text-sm">Buy</button>
          </Link>
        </div>
      </div>
    </article>
  );
}

