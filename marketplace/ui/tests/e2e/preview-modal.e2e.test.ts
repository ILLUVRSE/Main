/**
 * marketplace/ui/tests/e2e/preview-modal.e2e.test.ts
 *
 * E2E test: POST /sku/{sku_id}/preview -> assert session object returned.
 *
 * This test is intentionally minimal: it verifies the backend preview API
 * returns the expected fields (session_id, endpoint, expires_at) for a
 * deterministic test SKU (`e2e-sku-001`).
 *
 * Run with vitest (same pattern as other e2e tests):
 * MARKERPLACE_BASE_URL=http://127.0.0.1:3000 npx vitest run tests/e2e/preview-modal.e2e.test.ts --runInBand
 */

import { test, expect } from 'vitest';

const BASE = process.env.MARKETPLACE_BASE_URL ?? 'http://127.0.0.1:3000';
const FETCH_TIMEOUT = 20_000;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal } as RequestInit);
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

test('POST /sku/:id/preview returns preview session with required fields', async () => {
  const skuId = 'e2e-sku-001';

  const res = await fetchWithTimeout(`${BASE}/sku/${encodeURIComponent(skuId)}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_in_seconds: 600 }),
  }, 15_000);

  expect(res.ok, `Preview endpoint returned ${res.status}`).toBe(true);

  const body = await res.json();
  // Backend uses envelope { ok: true, session_id?, endpoint?, expires_at? }
  expect(body).toBeTruthy();
  expect(body.ok).toBeTruthy();

  // Assert at least one of session_id/endpoint present
  const hasSessionId = !!body.session_id;
  const hasEndpoint = !!body.endpoint;
  expect(hasSessionId || hasEndpoint).toBe(true);

  if (hasSessionId) {
    expect(typeof body.session_id).toBe('string');
    expect(body.session_id.length).toBeGreaterThan(5);
  }

  if (hasEndpoint) {
    expect(typeof body.endpoint).toBe('string');
    expect(body.endpoint.length).toBeGreaterThan(5);
    // Basic sanity: endpoint should look like a URL or ws
    expect(body.endpoint.startsWith('ws://') || body.endpoint.startsWith('wss://') || body.endpoint.startsWith('http://') || body.endpoint.startsWith('https://')).toBe(true);
  }

  if (body.expires_at) {
    // ensure expires_at is a parseable date in the future
    const dt = Date.parse(body.expires_at);
    expect(Number.isFinite(dt)).toBe(true);
    expect(dt).toBeGreaterThan(Date.now() - 1000); // sometime after now (tiny tolerance)
  }
}, 30_000);

