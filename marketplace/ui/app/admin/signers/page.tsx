'use client';

import React from 'react';
import SignerRegistry from '@/components/SignerRegistry';

/**
 * Admin Signers page
 *
 * Simple page that renders the SignerRegistry admin component.
 * This page is client-side because the registry component uses client-side
 * auth and fetches admin routes.
 */

export default function AdminSignersPage() {
  return (
    <section>
      <div className="mb-6">
        <h2 className="text-2xl font-heading font-bold">Signer Registry</h2>
        <p className="text-sm text-muted mt-1">
          Manage signer public keys used by Kernel, ArtifactPublisher and the audit system.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <SignerRegistry />
      </div>
    </section>
  );
}

