'use client';

import React, { useState } from 'react';
import api from '@/lib/api';

/**
 * Simple license verify page:
 * - Paste a signed license JSON (or upload)
 * - Optionally provide expected buyer id
 * - Calls POST /license/verify and displays verification result
 */

export default function LicenseVerifyPage() {
  const [text, setText] = useState<string>('');
  const [expectedBuyer, setExpectedBuyer] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ verified?: boolean; details?: any } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    setError(null);
    setResult(null);

    if (!text || text.trim().length === 0) {
      setError('Please paste a signed license JSON into the box.');
      return;
    }

    let licenseObj: any = null;
    try {
      licenseObj = JSON.parse(text);
    } catch (e) {
      setError('Invalid JSON. Please ensure the license is valid JSON.');
      return;
    }

    try {
      setLoading(true);
      const resp = await api.postLicenseVerify(licenseObj, expectedBuyer || undefined);
      setResult({ verified: resp.verified, details: resp.details });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('Verify failed', err);
      setError(err?.message || 'Verification request failed');
    } finally {
      setLoading(false);
    }
  }

  function handlePasteSample() {
    const sample = {
      license_id: 'lic-sample-123',
      order_id: 'order-sample-1',
      sku_id: 'sku-abc-123',
      buyer_id: 'buyer:alice@example.com',
      scope: { type: 'single-user', expires_at: '2026-01-01T00:00:00Z' },
      issued_at: new Date().toISOString(),
      signer_kid: 'artifact-publisher-signer-v1',
      signature: 'BASE64_SIGNATURE_PLACEHOLDER',
      canonical_payload: { /* ... */ },
    };
    setText(JSON.stringify(sample, null, 2));
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const txt = await f.text();
      setText(txt);
    } catch (err) {
      setError('Failed to read file');
    }
  }

  return (
    <section>
      <h2 className="text-2xl font-heading font-bold mb-4">License Verification</h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card">
          <div className="mb-3 text-sm text-muted">Paste a signed license JSON below (or upload a .json file)</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={18}
            className="w-full rounded-md border p-3 font-mono text-sm"
            placeholder="Paste signed license JSON here..."
          />

          <div className="mt-3 flex items-center gap-3">
            <input type="file" accept=".json,application/json" onChange={handleUpload} />
            <button className="btn-ghost" onClick={handlePasteSample}>Paste sample</button>
          </div>

          {error && <div className="mt-3 text-red-600">{error}</div>}
        </div>

        <aside className="card">
          <div>
            <label className="block">
              <div className="text-sm font-medium">Expected buyer id (optional)</div>
              <input
                value={expectedBuyer}
                onChange={(e) => setExpectedBuyer(e.target.value)}
                placeholder="buyer:alice@example.com"
                className="mt-1 block w-full rounded-md border px-3 py-2"
              />
            </label>

            <div className="mt-4">
              <button className="btn-primary w-full" onClick={handleVerify} disabled={loading}>
                {loading ? 'Verifying…' : 'Verify License'}
              </button>
            </div>

            {result && (
              <div className={`mt-4 p-3 rounded ${result.verified ? 'proof-success' : 'bg-yellow-50'}`}>
                <div className="font-semibold">{result.verified ? 'Verified' : 'Not verified'}</div>
                <pre className="mt-2 text-sm overflow-auto">{JSON.stringify(result.details || {}, null, 2)}</pre>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

