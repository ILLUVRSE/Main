'use client';

import React, { useState } from 'react';
import api from '@/lib/api';
import type { License } from '@/types';
import clsx from 'clsx';

type Props = {
  license: License | null;
  expectedBuyerId?: string;
  onVerified?: (res: { verified: boolean; details?: any }) => void;
};

/**
 * LicenseCard
 *
 * Shows a signed license object, allows verifying it (POST /license/verify),
 * and offers download/copy actions.
 *
 * Usage:
 *  <LicenseCard license={order.license} expectedBuyerId={order.buyer_id} />
 */

export default function LicenseCard({ license, expectedBuyerId, onVerified }: Props) {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{ verified: boolean; details?: any } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!license) {
    return <div className="text-muted">No license available.</div>;
  }

  async function handleVerify() {
    setVerifying(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.postLicenseVerify(license, expectedBuyerId);
      const out = { verified: Boolean(res.verified), details: res.details };
      setResult(out);
      onVerified?.(out);
    } catch (err: any) {
      setError(err?.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  }

  function download() {
    try {
      const blob = new Blob([JSON.stringify(license, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `license-${license.license_id || 'unknown'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // noop
    }
  }

  function copy() {
    try {
      navigator.clipboard?.writeText(JSON.stringify(license, null, 2));
      // eslint-disable-next-line no-alert
      alert('License copied to clipboard');
    } catch {
      // eslint-disable-next-line no-alert
      alert('Copy failed');
    }
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted">License</div>
          <div className="font-medium">{license.license_id || '—'}</div>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn-outline text-sm" onClick={download}>Download</button>
          <button className="btn-ghost text-sm" onClick={copy}>Copy</button>
        </div>
      </div>

      <div className="mt-3 text-sm text-muted">
        <div><strong>Buyer:</strong> {license.buyer_id || '—'}</div>
        <div className="mt-2"><strong>SKU:</strong> {license.sku_id || '—'}</div>
        <div className="mt-2"><strong>Issued:</strong> {license.issued_at || '—'}</div>
      </div>

      <div className="mt-4">
        <button className="btn-primary w-full" onClick={handleVerify} disabled={verifying}>
          {verifying ? 'Verifying…' : 'Verify license'}
        </button>

        {result && (
          <div className={clsx('mt-3 p-3 rounded', result.verified ? 'proof-success' : 'bg-yellow-50')}>
            <div className="font-semibold">{result.verified ? 'Verified' : 'Verification failed'}</div>
            <pre className="mt-2 text-sm overflow-auto">{JSON.stringify(result.details || {}, null, 2)}</pre>
          </div>
        )}

        {error && <div className="mt-3 text-red-600">{error}</div>}
      </div>

      <div className="mt-4">
        <details className="text-sm">
          <summary className="cursor-pointer">Raw license</summary>
          <pre className="mt-2 bg-gray-50 p-3 rounded text-sm overflow-auto">{JSON.stringify(license, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}

