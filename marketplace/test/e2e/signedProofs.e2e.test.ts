/**
 * marketplace/test/e2e/signedProofs.e2e.test.ts
 *
 * E2E test: verify signed delivery proofs + audit linkage.
 *
 * Prereqs:
 * - A running Marketplace dev instance at MARKERPLACE_BASE_URL (default http://127.0.0.1:3000).
 * - A completed order with a delivery proof (this test will create one deterministically).
 * - Optionally: set SIGNER_PUBLIC_KEY_PEM environment variable to a PEM public key to verify signatures.
 *
 * Run:
 *   MARKERPLACE_BASE_URL=http://127.0.0.1:3000 npx vitest run test/e2e/signedProofs.e2e.test.ts --runInBand
 */

import { test, expect } from 'vitest';
import * as crypto from 'crypto';

const BASE = process.env.MARKETPLACE_BASE_URL ?? 'http://127.0.0.1:3000';
const FETCH_TIMEOUT = 20_000;
const POLL_INTERVAL = 1000;
const POLL_TIMEOUT = 60_000;

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

function verifySignatureRsaPem(publicKeyPem: string, message: string | Buffer, signatureB64: string) {
  const verifier = crypto.createVerify('sha256');
  verifier.update(typeof message === 'string' ? Buffer.from(message, 'utf8') : message);
  verifier.end();
  const sigBuf = Buffer.from(signatureB64, 'base64');
  return verifier.verify(publicKeyPem, sigBuf);
}

test('signed proof contains required fields and signature verifies when possible', async () => {
  // 1) Create a minimal checkout (reuse test from checkout e2e)
  const idempotencyKey = `e2e-proof-${Date.now()}`;
  const checkoutBody = {
    sku_id: 'e2e-sku-001',
    buyer_id: 'user:e2e-buyer@example.com',
    payment_method: { provider: 'mock', payment_intent: `pi-${Date.now()}` },
    billing_metadata: { company: 'ProofCo' },
    delivery_preferences: {
      mode: 'buyer-managed',
      buyer_public_key: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey
        .export({ type: 'spki', format: 'pem' })
        .toString(),
      key_identifier: 'e2e-proof-buyer',
    },
    order_metadata: { correlation_id: `corr-${Date.now()}` },
  };

  const checkoutRes = await fetchWithTimeout(`${BASE}/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
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

  // 2) Fire payment webhook (mock)
  const webhookBody = {
    order_id: order.order_id,
    status: 'paid',
    amount: order.amount ?? 0,
    currency: order.currency ?? 'USD',
    provider: 'mock',
    reference: `payref-${Date.now()}`,
  };

  const webhookRes = await fetchWithTimeout(`${BASE}/webhooks/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookBody),
  });
  expect(webhookRes.ok).toBe(true);
  const webhookJson = await webhookRes.json();
  expect(webhookJson.ok ?? true).toBe(true);

  // 3) Wait for settled/finalized
  const settledOrder = await pollOrderStatus(order.order_id, 'settled', 60_000);
  expect(['settled', 'finalized', 'paid']).toContain(String(settledOrder.status).toLowerCase());

  // 4) Ensure delivery/proof exists
  // Some implementations attach proof under order.delivery.proof_id or delivery.proof_id
  const orderRes = await fetchWithTimeout(`${BASE}/order/${encodeURIComponent(order.order_id)}`, { method: 'GET' });
  expect(orderRes.ok).toBe(true);
  const orderJson = await orderRes.json();
  expect(orderJson.ok).toBe(true);
  const finalOrder = orderJson.order;
  expect(finalOrder).toBeTruthy();

  if (!finalOrder.delivery || !finalOrder.delivery.proof_id) {
    // If no proof was produced, fail the test.
    throw new Error(`No delivery proof found for order ${order.order_id}. Order object: ${JSON.stringify(finalOrder)}`);
  }

  const proofId = finalOrder.delivery.proof_id;

  // 5) Fetch the proof and assert structure
  const proofRes = await fetchWithTimeout(`${BASE}/proofs/${encodeURIComponent(proofId)}`, { method: 'GET' });
  expect(proofRes.ok).toBe(true);
  const proofJson = await proofRes.json();
  expect(proofJson.ok).toBe(true);
  const proof = proofJson.proof;
  expect(proof).toBeTruthy();
  // Required fields
  expect(proof.proof_id).toBe(proofId);
  expect(proof.order_id).toBe(order.order_id);
  expect(proof.artifact_sha256).toBeTruthy();
  expect(proof.signer_kid).toBeTruthy();
  expect(proof.signature).toBeTruthy(); // base64
  expect(proof.canonical_payload).toBeTruthy();

  // 6) If canonical_payload present and a public key is provided via env, verify signature
  const publicKeyPem = process.env.SIGNER_PUBLIC_KEY_PEM ?? '';
  if (publicKeyPem && proof.canonical_payload) {
    // Verify signature over canonical payload (assumes signer used RSA PKCS#1 v1.5 + sha256)
    const ok = verifySignatureRsaPem(publicKeyPem, proof.canonical_payload, proof.signature);
    expect(ok, 'Signature did not verify against provided public key').toBe(true);
  } else if (publicKeyPem && !proof.canonical_payload) {
    // If we have a public key but the proof didn't include canonical_payload, attempt best-effort:
    // some implementations sign a concatenated canonical object or a known JSON string. We cannot guess;
    // therefore assert presence of canonical_payload for verification to be meaningful.
    test.skip('Proof does not include canonical_payload; skipping signature verification');
  } else {
    // No public key provided — assert presence of signature and signer_kid only
    // (This ensures a signature was created even if we can't verify it here).
    expect(proof.signature).toBeTruthy();
    expect(proof.signer_kid).toBeTruthy();
  }

  // 7) Optionally verify audit linkage if endpoint exists
  // Try common endpoint: GET /order/{id}/audit or /order/{id}/audits
  let auditList = null;
  try {
    const auditRes = await fetchWithTimeout(`${BASE}/order/${encodeURIComponent(order.order_id)}/audit`, { method: 'GET' }, 10_000);
    if (auditRes.ok) {
      const auditJson = await auditRes.json();
      if (auditJson.ok && Array.isArray(auditJson.audit)) {
        auditList = auditJson.audit;
        // Ensure at least one audit event references this order or proof
        const found = auditList.some((a: any) => {
          if (!a.payload) return false;
          const p = JSON.stringify(a.payload);
          return p.includes(order.order_id) || p.includes(proofId) || (a.event_type && String(a.event_type).toLowerCase().includes('delivery'));
        });
        expect(found, 'No audit event referencing order or proof found in /order/{id}/audit').toBe(true);
      }
    }
  } catch (e) {
    // Some impls don't expose this endpoint — ok to skip
  }

  // If auditList was returned, do some lightweight checks
  if (auditList) {
    const first = auditList[0];
    expect(first.hash || first.signature).toBeDefined();
    // If signature exists, assert signer_kid present
    if (first.signature) expect(first.signer_kid || first.signerId || first.signer).toBeTruthy();
  }
}, 120_000);
