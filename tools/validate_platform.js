#!/usr/bin/env node
/**
 * tools/validate_platform.js
 *
 * Run a full platform validation for ILLUVRSE/Main.
 * Node 18+ required (uses global fetch).
 *
 * Usage:
 *   PLATFORM_CONFIG=tools/platform-config.json node tools/validate_platform.js > tools/platform-results.json
 *
 * Exit code:
 *   0 - all tests passed
 *   1 - one or more tests failed
 */

import fs from 'fs/promises';
import crypto from 'crypto';
import process from 'process';

const CONFIG_PATH = process.env.PLATFORM_CONFIG || 'tools/platform-config.json';
const results = [];

function now() { return new Date().toISOString(); }

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    // fall back to env-defaults
    return {
      kernelUrl: process.env.KERNEL_URL || 'http://127.0.0.1:6050',
      artifactPublisherUrl: process.env.ARTIFACT_PUBLISHER_URL || 'http://127.0.0.1:6137',
      marketplaceUrl: process.env.MARKETPLACE_URL || 'http://127.0.0.1:3000',
      marketplaceTestBuyerToken: process.env.MARKETPLACE_TEST_BUYER_TOKEN || '',
    };
  }
}

async function tryUrlsHealth(base) {
  // try /health, /ready, /
  const tries = ['/health', '/ready', '/'];
  for (const p of tries) {
    try {
      const url = `${base.replace(/\/$/, '')}${p}`;
      const res = await fetch(url, { method: 'GET' , headers: { Accept: 'application/json' }});
      if (res.ok) {
        let body = null;
        try { body = await res.json(); } catch(e) { body = await res.text(); }
        return { ok: true, url, status: res.status, body };
      }
    } catch (err) {
      // ignore, try next
    }
  }
  return { ok: false, tried: tries.map(p => `${base}${p}`) };
}

async function postJson(url, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = text; }
  return { ok: res.ok, status: res.status, body: json, raw: text };
}

async function getJson(url, opts = {}) {
  const headers = opts.headers || {};
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = text; }
  return { ok: res.ok, status: res.status, body: json, raw: text };
}

function pushResult(component, test, success, details = null, suggested_fix = null) {
  results.push({
    ts: now(),
    component,
    test,
    success: Boolean(success),
    details,
    suggested_fix,
  });
}

async function kernelTests(cfg) {
  const base = cfg.kernelUrl;
  const health = await tryUrlsHealth(base);
  if (health.ok) {
    pushResult('kernel', 'health', true, { probe: health.url, status: health.status, body: health.body });
  } else {
    pushResult('kernel', 'health', false, { tried: health.tried }, 'Ensure Kernel is reachable and exposes /health or /ready. Start kernel or check network.');
  }

  // minimal sanity: submit audit event to /audit/log
  try {
    const url = `${base.replace(/\/$/, '')}/audit/log`;
    const event = { actor_id: 'e2e:test', event_type: 'e2e.platform.validate', payload: { ts: now() } };
    const res = await postJson(url, { event }, { timeout: 15000 });
    if (res.ok || (res.status >= 200 && res.status < 300)) {
      pushResult('kernel', 'audit-log', true, { url, status: res.status, body: res.body });
    } else {
      pushResult('kernel', 'audit-log', false, { url, status: res.status, body: res.body }, 'Kernel audit endpoint returned non-2xx. Check kernel audit handler and authentication/mTLS.');
    }
  } catch (e) {
    pushResult('kernel', 'audit-log', false, { error: String(e) }, 'Kernel /audit/log not reachable. Confirm kernel is running or artifact-publisher run-local mock kernel is started.');
  }
}

async function artifactPublisherTests(cfg) {
  const base = cfg.artifactPublisherUrl;
  const health = await tryUrlsHealth(base);
  if (health.ok) {
    pushResult('artifact-publisher', 'health', true, { probe: health.url, status: health.status, body: health.body });
  } else {
    pushResult('artifact-publisher', 'health', false, { tried: health.tried }, 'Start artifact-publisher (run-local.sh) and ensure ARTIFACT_PUBLISHER_PORT is reachable. See artifact-publisher README run-local.sh.');
  }

  // sandbox run
  try {
    const url = `${base.replace(/\/$/, '')}/api/sandbox/run`;
    const instruction = { instructions: [{ op: 'checkout', payload: { test: 'e2e' } }] };
    const res = await postJson(url, instruction);
    if (res.ok && res.body && res.body.exitCode === 0) {
      pushResult('artifact-publisher', 'sandbox-run', true, { url, result: res.body });
    } else {
      pushResult('artifact-publisher', 'sandbox-run', false, { url, status: res.status, body: res.body }, 'Sandbox runner should return exitCode 0. Check SandboxRunner seed/config.');
    }
  } catch (e) {
    pushResult('artifact-publisher', 'sandbox-run', false, { error: String(e) }, 'artifact-publisher /api/sandbox/run not reachable. Ensure the service is started and ARTIFACT_PUBLISHER_DISABLE_LISTENER is not set (or adjust URL).');
  }
}

async function marketplaceE2ETests(cfg) {
  const base = cfg.marketplaceUrl.replace(/\/$/, '');
  // 1) health/readiness
  const health = await tryUrlsHealth(cfg.marketplaceUrl);
  if (health.ok) {
    pushResult('marketplace', 'health', true, { probe: health.url, status: health.status, body: health.body });
  } else {
    pushResult('marketplace', 'health', false, { tried: health.tried }, 'Start marketplace (run-local.sh) and ensure /health or /ready responds. See marketplace README.');
  }

  // 2) pick an SKU (prefer e2e-sku-001)
  let skuId = 'e2e-sku-001';
  try {
    const catRes = await getJson(`${base}/catalog`);
    if (catRes.ok && Array.isArray(catRes.body?.items) && catRes.body.items.length > 0) {
      // if e2e-sku-001 exists, keep, else pick first manifest_valid sku
      const found = (catRes.body.items || []).find(it => it.sku_id === 'e2e-sku-001' || it.manifest_valid === true);
      if (found) skuId = found.sku_id || skuId;
      pushResult('marketplace', 'catalog', true, { catalog_sample: (catRes.body.items || []).slice(0,3) });
    } else {
      pushResult('marketplace', 'catalog', false, { status: catRes.status, body: catRes.body }, 'Catalog read failed. Ensure database & seeds applied (run-seed).');
    }
  } catch (e) {
    pushResult('marketplace', 'catalog', false, { error: String(e) }, 'GET /catalog failed. Start marketplace and ensure DB (migrations & seeds) are applied.');
  }

  // 3) perform checkout -> payment webhook -> wait settled -> license/proof checks
  try {
    // gen buyer RSA key
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const buyerPublicKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const idempotencyKey = `e2e-${Date.now()}`;
    const checkoutBody = {
      sku_id: skuId,
      buyer_id: 'user:e2e-buyer@example.com',
      payment_method: { provider: 'mock', payment_intent: `pi-${Date.now()}` },
      billing_metadata: { company: 'E2E Co.' },
      delivery_preferences: { mode: 'buyer-managed', buyer_public_key: buyerPublicKey, key_identifier: 'e2e-buyer' },
      order_metadata: { correlation_id: `corr-${Date.now()}` }
    };

    const checkoutRes = await fetch(`${base}/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...(cfg.marketplaceTestBuyerToken ? { Authorization: `Bearer ${cfg.marketplaceTestBuyerToken}` } : {}),
      },
      body: JSON.stringify(checkoutBody),
    });

    if (!checkoutRes.ok) {
      const txt = await checkoutRes.text();
      pushResult('marketplace', 'checkout', false, { status: checkoutRes.status, body: txt }, 'Checkout request failed. Check marketplace auth / buyer token and sku availability.');
      return;
    }
    const checkoutJson = await checkoutRes.json();
    if (!checkoutJson.ok) {
      pushResult('marketplace', 'checkout', false, { body: checkoutJson }, 'Checkout returned ok:false. Inspect error details.');
      return;
    }
    const order = checkoutJson.order;
    pushResult('marketplace', 'checkout', true, { order });

    // simulate payment webhook
    const paymentWebhook = {
      order_id: order.order_id,
      status: 'paid',
      amount: order.amount ?? 0,
      currency: order.currency ?? 'USD',
      provider: 'mock',
      reference: `payref-${Date.now()}`
    };
    const whRes = await postJson(`${base}/webhooks/payment`, paymentWebhook);
    if (!(whRes.ok || (whRes.status >= 200 && whRes.status < 300))) {
      pushResult('marketplace', 'payment-webhook', false, { status: whRes.status, body: whRes.body }, 'Payment webhook failed to be accepted by marketplace.');
      return;
    } else {
      pushResult('marketplace', 'payment-webhook', true, { status: whRes.status, body: whRes.body });
    }

    // poll until order is settled (timeout 60s)
    const timeoutMs = 60_000;
    const pollInterval = 1000;
    let settledOrder = null;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const oRes = await getJson(`${base}/order/${encodeURIComponent(order.order_id)}`);
      if (oRes.ok && oRes.body?.order && ['settled','paid','finalized'].includes(String(oRes.body.order.status).toLowerCase())) {
        settledOrder = oRes.body.order;
        break;
      }
      await new Promise(r => setTimeout(r, pollInterval));
    }
    if (!settledOrder) {
      pushResult('marketplace', 'wait-settled', false, { orderId: order.order_id }, 'Order did not reach settled state within timeout. Check payment/finance mocks.');
      return;
    } else {
      pushResult('marketplace', 'wait-settled', true, { order: settledOrder });
    }

    // check license endpoint
    const licenseRes = await getJson(`${base}/order/${encodeURIComponent(order.order_id)}/license`);
    if (!licenseRes.ok || !licenseRes.body?.license) {
      pushResult('marketplace', 'license', false, { status: licenseRes.status, body: licenseRes.body }, 'License endpoint failed to return a signed license. Check finalization and signer path.');
    } else {
      pushResult('marketplace', 'license', true, { license: licenseRes.body.license });
    }

    // if there is a proof id, fetch it
    const proofId = settledOrder.delivery?.proof_id || settledOrder.delivery?.proofId || null;
    if (proofId) {
      const proofRes = await getJson(`${base}/proofs/${encodeURIComponent(proofId)}`);
      if (!proofRes.ok) {
        pushResult('marketplace', 'proof-fetch', false, { status: proofRes.status, body: proofRes.body }, 'Could not fetch proof. Check ArtifactPublisher integration and signed proof generation.');
      } else {
        pushResult('marketplace', 'proof-fetch', true, { proof: proofRes.body.proof || proofRes.body });
      }
    } else {
      pushResult('marketplace', 'proof-fetch', false, { reason: 'no_proof_id', order: settledOrder }, 'Order had no delivery proof id. Verify finalize step and ArtifactPublisher call.');
    }
  } catch (e) {
    pushResult('marketplace', 'e2e-flow', false, { error: String(e) }, 'Marketplace e2e flow threw an exception. Ensure marketplace run-local and all mocks are configured.');
  }
}

async function main() {
  const cfg = await loadConfig();

  // quick repo sanity pointers (non-executable): presence of CI and allowlists referenced in suggested fixes
  // Run tests
  await kernelTests(cfg);
  await artifactPublisherTests(cfg);
  await marketplaceE2ETests(cfg);

  // finalize: print JSON results
  const out = { generated_at: now(), results };
  const jsonOut = JSON.stringify(out, null, 2);
  // write to stdout
  console.log(jsonOut);

  // exit code
  const allOk = results.every(r => r.success === true);
  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('fatal', String(err));
  process.exit(2);
});
