'use client';

import React, { useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { KernelManifest } from '@/types';

/**
 * AdminUploader
 *
 * Simple manifest upload and validation UI for operators.
 * - Accepts a Kernel-signed manifest JSON file or pasted JSON.
 * - Shows manifest validation result returned by POST /sku (via server-side manifestValidator).
 * - Allows entering minimal catalog metadata and submitting to register SKU.
 *
 * Note: This component calls the public POST /sku operator endpoint and expects
 * the server to enforce operator authorization (KERNEL_CONTROL_PANEL_TOKEN or operator role).
 */

export default function AdminUploader() {
  const { user, token, isOperator } = useAuth();
  const [manifestText, setManifestText] = useState<string>('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [manifestObj, setManifestObj] = useState<KernelManifest | null>(null);
  const [catalogTitle, setCatalogTitle] = useState<string>('');
  const [catalogSummary, setCatalogSummary] = useState<string>('');
  const [priceCents, setPriceCents] = useState<number>(0);
  const [currency, setCurrency] = useState<string>('USD');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOperator()) {
    return (
      <div className="card">
        <div className="text-sm text-muted">Operator authorization required to upload manifests.</div>
      </div>
    );
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    try {
      const txt = await f.text();
      setManifestText(txt);
      try {
        const parsed = JSON.parse(txt);
        setManifestObj(parsed);
        // prefill title/summary if present
        setCatalogTitle(parsed.title || '');
        setCatalogSummary(parsed.description || parsed.summary || '');
      } catch {
        setManifestObj(null);
      }
    } catch (err) {
      setError('Failed to read file');
    }
  }

  function handlePaste() {
    try {
      const parsed = JSON.parse(manifestText);
      setManifestObj(parsed);
      setCatalogTitle(parsed.title || '');
      setCatalogSummary(parsed.description || parsed.summary || '');
      setError(null);
    } catch {
      setError('Invalid JSON manifest');
      setManifestObj(null);
    }
  }

  async function handleSubmit() {
    setError(null);
    setResult(null);

    if (!manifestObj) {
      setError('Please provide a valid manifest (paste JSON or upload file)');
      return;
    }

    setLoading(true);
    try {
      // Build catalog metadata
      const catalog_metadata = {
        sku_id: undefined, // let server synthesize if not provided
        title: catalogTitle || manifestObj.title || 'Untitled SKU',
        summary: catalogSummary || manifestObj.description || '',
        price: priceCents || 0,
        currency: currency || 'USD',
      };

      // Use operator token (auth context) if available
      const operatorToken = token || undefined;

      const resp = await api.postSku(manifestObj, catalog_metadata, operatorToken);
      setResult(resp);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('SKU register failed', err);
      setError(err?.message || 'Register failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h3 className="text-lg font-semibold">Upload Kernel-signed Manifest (Operator)</h3>

      <div className="mt-3">
        <div className="text-sm text-muted">Upload file (.json) or paste manifest JSON below</div>

        <div className="mt-3 flex gap-3 items-center">
          <input type="file" accept=".json,application/json" onChange={handleFile} />
          <button
            className="btn-ghost"
            onClick={() => {
              setManifestText('');
              setManifestObj(null);
              setFileName(null);
              setError(null);
              setResult(null);
            }}
          >
            Clear
          </button>
        </div>

        <textarea
          value={manifestText}
          onChange={(e) => setManifestText(e.target.value)}
          rows={10}
          className="mt-3 w-full rounded-md border p-3 font-mono text-sm"
          placeholder="Paste manifest JSON here..."
        />

        <div className="mt-2 flex gap-2">
          <button className="btn-outline" onClick={handlePaste}>Parse manifest</button>
        </div>

        {manifestObj && (
          <div className="mt-4 p-3 bg-gray-50 rounded">
            <div className="text-sm"><strong>Detected manifest:</strong> {manifestObj.id || 'N/A'}</div>
            <div className="mt-2 text-sm">
              <strong>Title:</strong> {manifestObj.title || '—'}
            </div>
            <div className="mt-1 text-sm">
              <strong>Author:</strong> {manifestObj.author?.name || manifestObj.author?.id || '—'}
            </div>
            <div className="mt-2 text-sm">
              <strong>Signature:</strong> {manifestObj.manifest_signature?.signer_kid || '—'}
            </div>
          </div>
        )}

        <div className="mt-4">
          <h4 className="text-sm font-semibold">Catalog metadata</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
            <label>
              <div className="text-sm">Title</div>
              <input value={catalogTitle} onChange={(e) => setCatalogTitle(e.target.value)} className="mt-1 block w-full rounded-md border px-3 py-2" />
            </label>

            <label>
              <div className="text-sm">Price (cents)</div>
              <input type="number" value={priceCents} onChange={(e) => setPriceCents(Number(e.target.value || 0))} className="mt-1 block w-full rounded-md border px-3 py-2" />
            </label>

            <label className="md:col-span-2">
              <div className="text-sm">Summary</div>
              <input value={catalogSummary} onChange={(e) => setCatalogSummary(e.target.value)} className="mt-1 block w-full rounded-md border px-3 py-2" />
            </label>

            <label>
              <div className="text-sm">Currency</div>
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="mt-1 block w-full rounded-md border px-3 py-2" />
            </label>
          </div>
        </div>

        <div className="mt-4 flex gap-3">
          <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Registering…' : 'Register SKU'}
          </button>
          <button className="btn-ghost" onClick={() => {
            // quick manifest validation call: attempt to register but don't persist? For now we call register.
            handlePaste();
          }}>
            Validate JSON
          </button>
        </div>

        {error && <div className="mt-3 text-red-600">{error}</div>}
        {result && (
          <div className="mt-3">
            <div className="text-sm font-semibold">Result</div>
            <pre className="mt-2 bg-gray-50 p-3 rounded text-sm overflow-auto">{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

