import { test, expect, APIRequestContext } from '@playwright/test';
import crypto from 'crypto';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const FETCH_TIMEOUT = 30_000;
const POLL_INTERVAL = 1000;
const POLL_TIMEOUT = 60_000;

async function pollOrderStatus(request: APIRequestContext, orderId: string, desired: string, timeoutMs = POLL_TIMEOUT) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`${BASE}/order/${encodeURIComponent(orderId)}`);
    if (res.ok()) {
      const body = await res.json();
      if (body?.ok && body.order?.status) {
        if (String(body.order.status).toLowerCase() === desired.toLowerCase()) {
          return body.order;
        }
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(`Order ${orderId} did not reach status=${desired} within timeout`);
}

test('playwright smoke: checkout -> payment webhook -> finalize -> license + proof', async ({ request }) => {
  test.setTimeout(120_000);

  // 1) Health check
  const health = await request.get(`${BASE}/health`);
  expect(health.ok()).toBeTruthy();
  const healthJson = await health.json();
  expect(healthJson.ok).toBeTruthy();

  // 2) Create checkout
  const idempotencyKey = `playwright-e2e-${Date.now()}`;
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const buyerPublicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const checkoutBody = {
    sku_id: 'e2e-sku-001',
    buyer_id: 'user:playwright@example.com',
    payment_method: { provider: 'mock', payment_intent: `pi-${Date.now()}` },
    billing_metadata: { company: 'Playwright Inc' },
    delivery_preferences: { mode: 'buyer-managed', buyer_public_key: buyerPublicKey, key_identifier: 'playwright' },
    order_metadata: { correlation_id: `corr-${Date.now()}` },
  };

  const checkoutRes = await request.post(`${BASE}/checkout`, {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      // Optionally set Authorization for test buyer if your dev server requires it:
      // Authorization: process.env.MARKETPLACE_TEST_BUYER_TOKEN ? `Bearer ${process.env.MARKETPLACE_TEST_BUYER_TOKEN}` : '',
    },
    data: checkoutBody,
    timeout: FETCH_TIMEOUT,
  });

  expect(checkoutRes.ok()).toBeTruthy();
  const checkoutJson = await checkoutRes.json();
  expect(checkoutJson.ok).toBeTruthy();
  const order = checkoutJson.order;
  expect(order).toBeTruthy();
  expect(order.order_id).toBeTruthy();
  expect(['pending', 'created']).toContain(String(order.status).toLowerCase());

  // 3) Simulate payment provider webhook (mock)
  const paymentWebhookBody = {
    order_id: order.order_id,
    status: 'paid',
    amount: order.amount ?? 0,
    currency: order.currency ?? 'USD',
    provider: 'mock',
    reference: `payref-${Date.now()}`,
  };

  const webhookRes = await request.post(`${BASE}/webhooks/payment`, {
    headers: { 'Content-Type': 'application/json' },
    data: paymentWebhookBody,
    timeout: FETCH_TIMEOUT,
  });

  // webhook handler should ack (200). Some implementations may return 200 with ok:true or ok:false
  expect(webhookRes.ok()).toBeTruthy();
  const webhookJson = await webhookRes.json().catch(() => ({}));
  expect(typeof webhookJson === 'object').toBeTruthy();

  // 4) Wait for order to become 'settled' (or 'finalized')
  const settledOrder = await pollOrderStatus(request, order.order_id, 'settled', POLL_TIMEOUT);
  expect(settledOrder.status.toLowerCase()).toBe('settled');

  // 5) Fetch the order and verify license + delivery
  const orderRes = await request.get(`${BASE}/order/${encodeURIComponent(order.order_id)}`);
  expect(orderRes.ok()).toBeTruthy();
  const orderJson = await orderRes.json();
  expect(orderJson.ok).toBeTruthy();
  const fetchedOrder = orderJson.order;

  expect(['settled', 'paid', 'finalized']).toContain(String(fetchedOrder.status).toLowerCase());

  // 6) If delivery proof present, verify proofs endpoint
  if (fetchedOrder.delivery && fetchedOrder.delivery.proof_id) {
    const proofId = fetchedOrder.delivery.proof_id;
    const proofRes = await request.get(`${BASE}/proofs/${encodeURIComponent(proofId)}`, { timeout: FETCH_TIMEOUT });
    expect(proofRes.ok()).toBeTruthy();
    const proofJson = await proofRes.json();
    expect(proofJson.ok).toBeTruthy();
    const proof = proofJson.proof;
    expect(proof.proof_id).toBeTruthy();
    expect(proof.signature || proof.signer_kid).toBeTruthy();
  }

  // 7) Check license endpoint
  const licenseRes = await request.get(`${BASE}/order/${encodeURIComponent(order.order_id)}/license`);
  expect(licenseRes.ok()).toBeTruthy();
  const licenseJson = await licenseRes.json();
  expect(licenseJson.ok).toBeTruthy();
  expect(licenseJson.license).toBeTruthy();
  expect(licenseJson.license.signed_license || licenseJson.license.signature).toBeTruthy();
});
