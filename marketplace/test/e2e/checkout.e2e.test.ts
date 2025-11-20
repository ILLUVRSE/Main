/**
 * marketplace/test/e2e/checkout.e2e.test.ts
 *
 * End-to-end test (deterministic) for:
 *   POST /checkout  -> creates pending order
 *   POST /webhooks/payment -> simulates payment provider notifying success
 *   (Marketplace calls Finance) -> Finance returns ledger proof
 *   Marketplace finalizes order -> issues signed license and delivery proof
 *
 * Requirements:
 * - A running Marketplace dev instance at MARKERPLACE_BASE_URL (run-local.sh or staging).
 * - Mocks for Finance / signing path that accept the flows used below, or a real test environment.
 *
 * Run:
 *   MARKERPLACE_BASE_URL=http://127.0.0.1:3000 npx vitest run test/e2e/checkout.e2e.test.ts --runInBand
 */

import { test, expect } from 'vitest';
import crypto from 'crypto';

const BASE = process.env.MARKETPLACE_BASE_URL ?? 'http://127.0.0.1:3000';
const FETCH_TIMEOUT = 30_000;
const POLL_INTERVAL = 1000;
const POLL_TIMEOUT = 60_000;

// small helper around fetch with timeout
async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function pollOrderStatus(orderId: string, desired: string, timeoutMs = POLL_TIMEOUT) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetchWithTimeout(`${BASE}/order/${encodeURIComponent(orderId)}`, { method: 'GET' });
    if (!res.ok) {
      // small backoff then continue
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
      continue;
    }
    const body = await res.json();
    if (body?.ok && body.order?.status) {
      if (String(body.order.status).toLowerCase() === desired.toLowerCase()) {
        return body.order;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(`Order ${orderId} did not reach status=${desired} within timeout`);
}

test('checkout -> payment webhook -> finalize -> license + proof', async () => {
  // 1) Create a deterministic checkout request
  const idempotencyKey = `e2e-${Date.now()}`;
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const buyerPublicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const checkoutBody = {
    sku_id: 'e2e-sku-001',
    buyer_id: 'user:e2e-buyer@example.com',
    payment_method: { provider: 'mock', payment_intent: `pi-${Date.now()}` },
    billing_metadata: { company: 'E2E Co.' },
    delivery_preferences: { mode: 'buyer-managed', buyer_public_key: buyerPublicKey, key_identifier: 'e2e-buyer' },
    order_metadata: { correlation_id: `corr-${Date.now()}` },
  };

  const checkoutRes = await fetchWithTimeout(`${BASE}/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      // Set an auth header if your dev server requires one for test buyers
      Authorization: process.env.MARKETPLACE_TEST_BUYER_TOKEN ? `Bearer ${process.env.MARKETPLACE_TEST_BUYER_TOKEN}` : '',
    },
    body: JSON.stringify(checkoutBody),
  });
  expect(checkoutRes.ok).toBe(true);
  const checkoutJson = await checkoutRes.json();
  expect(checkoutJson.ok).toBe(true);
  const order = checkoutJson.order;
  expect(order).toBeTruthy();
  expect(order.order_id).toBeTruthy();
  expect(['pending', 'created']).toContain(String(order.status).toLowerCase());

  // 2) Simulate payment provider webhook notifying success
  // The shape below should match your webhook handler expectations.
  const paymentWebhookBody = {
    order_id: order.order_id,
    status: 'paid',
    amount: order.amount ?? 0,
    currency: order.currency ?? 'USD',
    provider: 'mock',
    reference: `payref-${Date.now()}`,
  };

  const webhookRes = await fetchWithTimeout(`${BASE}/webhooks/payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // If your webhook signer expects a signature header, include it:
      // 'Stripe-Signature': 't=...,v1=signature...'
      // For local mocks, this may not be required.
    },
    body: JSON.stringify(paymentWebhookBody),
  });
  expect(webhookRes.ok).toBe(true);
  const webhookJson = await webhookRes.json();
  // webhook handler should ACK
  expect(webhookJson.ok ?? true).toBe(true);

  // 3) Wait for order to become 'settled' (or 'paid' depending on implementation)
  const settledOrder = await pollOrderStatus(order.order_id, 'settled', 60_000);
  expect(settledOrder.status.toLowerCase()).toBe('settled');

  // 4) After settlement, finalization should have occurred and license / proof information should be available
  const orderRes = await fetchWithTimeout(`${BASE}/order/${encodeURIComponent(order.order_id)}`, { method: 'GET' });
  expect(orderRes.ok).toBe(true);
  const orderJson = await orderRes.json();
  expect(orderJson.ok).toBe(true);
  const fetchedOrder = orderJson.order;
  expect(['settled', 'paid', 'finalized']).toContain(String(fetchedOrder.status).toLowerCase());
  expect(fetchedOrder.delivery_mode).toBe('buyer-managed');
  expect(fetchedOrder.key_metadata).toBeTruthy();

  // 5) If delivery proof present, verify license + proof endpoints
  if (fetchedOrder.delivery && fetchedOrder.delivery.proof_id) {
    const proofId = fetchedOrder.delivery.proof_id;
    const proofRes = await fetchWithTimeout(`${BASE}/proofs/${encodeURIComponent(proofId)}`, { method: 'GET' });
    expect(proofRes.ok).toBe(true);
    const proofJson = await proofRes.json();
    expect(proofJson.ok).toBe(true);
    const proof = proofJson.proof;
    expect(proof.proof_id).toBe(proofId);
    expect(proof.signature).toBeTruthy();
    expect(proof.signer_kid).toBeTruthy();
  }

  // 6) Check license endpoint
  const licenseRes = await fetchWithTimeout(`${BASE}/order/${encodeURIComponent(order.order_id)}/license`, { method: 'GET' });
  expect(licenseRes.ok).toBe(true);
  const licenseJson = await licenseRes.json();
  expect(licenseJson.ok).toBe(true);
  expect(licenseJson.license).toBeTruthy();
  expect(licenseJson.license.signed_license).toBeTruthy();

  // 7) Optionally: call license/verify to validate signature
  const verifyRes = await fetchWithTimeout(`${BASE}/license/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license: licenseJson.license.signed_license, expected_buyer_id: checkoutBody.buyer_id }),
  });
  expect(verifyRes.ok).toBe(true);
  const verifyJson = await verifyRes.json();
  // Either ok:true with verified:true, or your implementation may return verified flag
  if (verifyJson.ok) {
    expect(verifyJson.verified === true || verifyJson.verified === false).toBe(true);
    expect(verifyJson.verified).toBe(true);
  } else {
    // Some implementations may require a different verification flow — fail clearly
    throw new Error(`License verification failed: ${JSON.stringify(verifyJson)}`);
  }
}, 120_000); // generous timeout for e2e
