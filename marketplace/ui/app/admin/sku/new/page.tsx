'use client';

import React from 'react';
import AdminUploader from '@/components/AdminUploader';

/**
 * Admin SKU upload page
 *
 * Client page that renders the AdminUploader component.
 * Requires operator auth (AdminUploader enforces that).
 */

export default function AdminSkuNewPage() {
  return (
    <section>
      <div className="mb-6">
        <h2 className="text-2xl font-heading font-bold">Register SKU</h2>
        <p className="text-sm text-muted mt-1">
          Upload a Kernel-signed manifest and register a SKU for the catalog. Operator access required.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <AdminUploader />
      </div>
    </section>
  );
}

