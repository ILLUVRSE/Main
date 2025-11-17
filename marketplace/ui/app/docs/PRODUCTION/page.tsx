import React from 'react';
import Link from 'next/link';

/**
 * Production runbook page
 *
 * This page surfaces the high-level production runbook and links to deeper
 * operational docs. It is intentionally concise — link to your authoritative
 * markdown or runbook in the repository for full details.
 */

export default function ProductionRunbookPage() {
  return (
    <section>
      <div className="mb-6">
        <h1 className="text-3xl font-heading font-bold">Production Runbook</h1>
        <p className="text-muted mt-2">
          Operational guidance for deploying and running the Illuvrse Marketplace in production.
          This page summarizes the essential controls and links to the full runbook documents.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-xl font-semibold">High-level topology</h2>
          <p className="text-sm text-muted mt-2">
            Clients → CDN/WAF → Marketplace API (ECS/Fargate or K8s)  
            · ArtifactPublisher · Kernel (mTLS) · Finance · Signing Proxy/KMS · Preview Sandbox Pool · S3 Audit Archive
          </p>

          <h3 className="mt-4 font-semibold">Key principles</h3>
          <ul className="list-disc ml-5 mt-2 text-sm">
            <li>All signing must use KMS/HSM or an audited signing-proxy</li>
            <li>Kernel-signed manifest validation required before listing/delivery</li>
            <li>Audit exports written to S3 with Object Lock enabled</li>
            <li>Preview sandboxes run isolated and emit audit events</li>
          </ul>

          <div className="mt-4 text-sm">
            <Link href="/marketplace/docs/PRODUCTION.md" className="btn-outline">Open full runbook (repo)</Link>
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold">Operational readiness</h2>

          <div className="mt-3 text-sm">
            <div><strong>Environment vars</strong></div>
            <ul className="list-disc ml-5 mt-2">
              <li><code>DATABASE_URL</code>, <code>S3_AUDIT_BUCKET</code>, <code>SIGNING_PROXY_URL</code></li>
              <li><code>REQUIRE_KMS</code> / <code>REQUIRE_SIGNING_PROXY</code> enforced in CI</li>
              <li>mTLS certs for Kernel/Finance or control-plane tokens</li>
            </ul>
          </div>

          <div className="mt-3 text-sm">
            <div><strong>Monitoring & SLOs</strong></div>
            <ul className="list-disc ml-5 mt-2">
              <li>Checkout p95 &lt; 500ms</li>
              <li>Delivery encrypt failures &lt; 0.1%</li>
              <li>Audit export success &gt; 99%</li>
            </ul>
          </div>

          <div className="mt-4">
            <h3 className="font-semibold">Incidents & runbooks</h3>
            <ul className="list-disc ml-5 mt-2 text-sm">
              <li><strong>Signing/KMS down</strong> — fail closed; do not finalize orders; engage Security on-call.</li>
              <li><strong>Audit export failure</strong> — retry with backoff; notify on-call and escalate to SRE.</li>
              <li><strong>Sandbox breakout</strong> — isolate pool, revoke network routes, rotate image.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-6 card">
        <h3 className="text-lg font-semibold">Runbook links</h3>
        <ul className="mt-3 list-disc ml-5 text-sm">
          <li><Link href="/marketplace/docs/PRODUCTION.md" className="text-[var(--illuvrse-primary)]">Detailed Production Runbook (repo)</Link></li>
          <li><Link href="/admin/audit" className="text-[var(--illuvrse-primary)]">Audit Export Console</Link></li>
          <li><Link href="/admin/signers" className="text-[var(--illuvrse-primary)]">Signer Registry</Link></li>
          <li><Link href="/admin/finance" className="text-[var(--illuvrse-primary)]">Finance Dashboard</Link></li>
        </ul>
      </div>
    </section>
  );
}

