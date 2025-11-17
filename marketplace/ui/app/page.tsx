import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

/**
 * marketplace/ui/app/page.tsx
 *
 * Simple marketing/home hero using the Illuvrse brand tokens and imagery.
 * Links into the Marketplace and Docs. Keep the copy short and the hero bold.
 */

export default function HomePage() {
  return (
    <section className="hero">
      <div className="container">
        <div className="max-w-3xl mx-auto text-center">
          <div className="mb-8">
            <div className="mx-auto relative w-40 h-40">
              <Image
                src="/brand/logo-full.svg"
                alt="Illuvrse"
                fill
                style={{ objectFit: 'contain' }}
              />
            </div>
          </div>

          <h1 className="text-4xl md:text-5xl font-heading font-bold leading-tight mb-4">
            Marketplace for trusted models, proofs & licensed delivery
          </h1>

          <p className="text-lg text-muted mb-6">
            Discover Kernel-signed manifests, preview sandboxes, and buy with auditable
            signed proofs. Secure delivery, royalty-aware payouts, and verifiable licenses.
          </p>

          <div className="flex items-center justify-center gap-4">
            <Link href="/marketplace" className="btn-primary text-base px-6 py-3">
              Explore Marketplace
            </Link>
            <Link href="/docs/PRODUCTION" className="btn-outline text-base px-5 py-3">
              Read Runbook
            </Link>
          </div>

          <div className="mt-10 text-sm text-muted">
            <span className="mr-2">Trusted signing ·</span>
            <span className="mx-2">Preview sandboxes ·</span>
            <span className="ml-2">Auditable delivery</span>
          </div>
        </div>
      </div>
    </section>
  );
}

