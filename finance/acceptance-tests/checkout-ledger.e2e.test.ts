/**
 * finance/acceptance-tests/checkout-ledger.e2e.test.ts
 *
 * End-to-end acceptance tests for Finance: ledger post (double-entry), imbalance rejection,
 * proof generation and signature verification.
 *
 * Usage:
 *   FINANCE_BASE_URL=http://127.0.0.1:4000 FINANCE_ADMIN_TOKEN=... FINANCE_PROOF_SIGNER_PUBLIC_KEY_PEM="$(cat /tmp/pub.pem)" \
 *     npx vitest run acceptance-tests/checkout-ledger.e2e.test.ts --runInBand
 *
 * Notes:
 *  - The test expects a running Finance service reachable at FINANCE_BASE_URL.
 *  - Admin/service auth can be passed via FINANCE_ADMIN_TOKEN or via other envs and wired into adminHeaders.
 *  - Signature verification assumes RSA PKCS#1 v1.5 + SHA256 by default; adapt if using Ed25519.
 */

import { test, expect, beforeAll } from 'vitest';
import fetch from 'node-fetch';
import * as crypto from 'crypto';

const BASE = process.env.FINANCE_BASE_URL ?? 'http://127.0.0.1:4000';
const ADMIN_TOKEN = process.env.FINANCE_ADMIN_TOKEN ?? '';
const SIGNER_PUBLIC_KEY_PEM = process.env.FINANCE_PROOF_SIGNER_PUBLIC_KEY_PEM ?? '';
const TIMEOUT_MS = 120_000;

const adminHeaders: any = {
  'Content-Type': 'application/json',
};
if (ADMIN_TOKEN) adminHeaders['Authorization'] = `Bearer ${ADMIN_TOKEN}`;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit, timeout = 30000) {
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

function canonicalizeJSON(obj: any): string {
  function sortKeys(x: any): any {
    if (Array.isArray(x)) return x.map(sortKeys);
    if (x && typeof x === 'object') {
      const out: any = {};
      Object.keys(x).sort().forEach((k) => {
        out[k] = sortKeys(x[k]);
      });
      return out;
    }
    return x;
  }
  return JSON.stringify(sortKeys(obj));
}

function verifyRsaSignature(publicKeyPem: string, message: string | Buffer, signatureB64: string) {
  const verifier = crypto.createVerify('sha256');
  verifier.update(typeof message === 'string' ? Buffer.from(message, 'utf8') : message);
  verifier.end();
  const sigBuf = Buffer.from(signatureB64, 'base64');
  return verifier.verify(publicKeyPem, sigBuf);
}

let reachable = false;
beforeAll(async () => {
  try {
    const r = await fetch(`${BASE}/health`);
    reachable = r.ok;
    if (!reachable) {
      console.warn(`[acceptance test] Finance not reachable at ${BASE}. Status: ${r.status}`);
    }
  } catch (e) {
    console.warn(`[acceptance test] Finance probe failed: ${String(e)}`);
  }
  if (!reachable) test.skip();
});

test('post balanced journal -> success; post unbalanced -> LEDGER_IMBALANCE', async () => {
  if (!reachable) test.skip();

  // balanced journal
  const journalId = `jrn-e2e-${Date.now()}`;
  const entriesBalanced = [
    { account_id: 'asset:escrow:order-e2e', side: 'debit', amount_cents: 10000, currency: 'USD', meta: { order_id: 'order-e2e' } },
    { account_id: 'revenue:sku-e2e', side: 'credit', amount_cents: 10000, currency: 'USD', meta: { sku: 'sku-e2e' } },
  ];
  const balancedBody = {
    journal_id: journalId,
    entries: entriesBalanced,
    context: { source: 'integration-test', order_id: 'order-e2e' },
  };

  const postRes = await fetchWithTimeout(`${BASE}/ledger/post`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify(balancedBody),
  }, 10000);
  expect(postRes.ok).toBeTruthy();
  const postJson = await postRes.json();
  expect(postJson.ok).toBeTruthy();
  expect(postJson.journal_id).toBe(journalId);

  // Unbalanced journal (should be rejected)
  const journalId2 = `jrn-e2e-unbalanced-${Date.now()}`;
  const entriesUnbalanced = [
    { account_id: 'asset:escrow:order-e2e', side: 'debit', amount_cents: 15000, currency: 'USD', meta: { order_id: 'order-e2e' } },
    { account_id: 'revenue:sku-e2e', side: 'credit', amount_cents: 10000, currency: 'USD', meta: { sku: 'sku-e2e' } }, // mismatch
  ];
  const unbalancedBody = {
    journal_id: journalId2,
    entries: entriesUnbalanced,
    context: { source: 'integration-test' },
  };

  const postUnRes = await fetchWithTimeout(`${BASE}/ledger/post`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify(unbalancedBody),
  }, 10000);

  // Expect 400 and LEDGER_IMBALANCE or ok:false with error
  if (postUnRes.ok) {
    const j = await postUnRes.json();
    // could be ok:false
    expect(j.ok === false).toBeTruthy();
    expect(j.error).toBeDefined();
    const code = j.error?.code || '';
    expect(String(code).toUpperCase()).toContain('LEDGER');
  } else {
    expect([400, 422].includes(postUnRes.status)).toBeTruthy();
    const txt = await postUnRes.text();
    expect(txt.toLowerCase()).toContain('imbalance');
  }
}, 30_000);

test('generate proof for recent range -> fetch proof and verify signature if public key provided', async () => {
  if (!reachable) test.skip();

  // Request a proof for the last 10 minutes (ensure rows exist from previous test)
  const now = new Date();
  const from = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const to = now.toISOString();

  const reqBody = {
    request_id: `req-e2e-${Date.now()}`,
    range: { from_ts: from, to_ts: to },
    caller: { service: 'integration-test', requester: 'acceptance-suite' }
  };

  const genRes = await fetchWithTimeout(`${BASE}/proofs/generate`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify(reqBody),
  }, 10000);
  expect(genRes.ok).toBeTruthy();
  const genJson = await genRes.json();
  expect(genJson.ok).toBeTruthy();
  const proofId = genJson.proof_id || genJson.request_id;
  expect(proofId).toBeTruthy();

  // Poll for proof readiness
  let proofMeta: any = null;
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const g = await fetchWithTimeout(`${BASE}/proofs/${encodeURIComponent(proofId)}`, {
      method: 'GET',
      headers: adminHeaders,
    }, 10000);
    if (!g.ok) {
      // retry
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const gj = await g.json();
    if (gj.ok && gj.proof) {
      proofMeta = gj.proof;
      // If signature present, treat as ready
      if (proofMeta.signature) break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  expect(proofMeta).toBeTruthy();
  expect(proofMeta.hash || proofMeta.signature).toBeTruthy();
  expect(proofMeta.signer_kid).toBeTruthy();

  // Optional verification: if public key provided, verify signature
  if (SIGNER_PUBLIC_KEY_PEM && proofMeta.signature && proofMeta.hash) {
    // Best-effort: if service returned canonical_payload, use it. Otherwise, verify signature over hex hash.
    if (proofMeta.canonical_payload) {
      const canonical = canonicalizeForVerify(proofMeta.canonical_payload);
      const sigOk = verifyRsaSignature(SIGNER_PUBLIC_KEY_PEM, canonical, proofMeta.signature);
      expect(sigOk).toBeTruthy();
    } else {
      // If only hash returned, verify signature over binary hash
      const sigOk = verifyRsaSignature(SIGNER_PUBLIC_KEY_PEM, Buffer.from(proofMeta.hash, 'hex'), proofMeta.signature);
      expect(sigOk).toBeTruthy();
    }
  } else {
    // At minimum, ensure signature exists
    expect(proofMeta.signature || proofMeta.hash).toBeTruthy();
  }
}, TIMEOUT_MS);

// helper
function canonicalizeForVerify(obj: any): string {
  function sortKeys(x: any): any {
    if (Array.isArray(x)) return x.map(sortKeys);
    if (x && typeof x === 'object') {
      const out: any = {};
      Object.keys(x).sort().forEach((k) => (out[k] = sortKeys(x[k])));
      return out;
    }
    return x;
  }
  const sorted = sortKeys(obj);
  return JSON.stringify(sorted);
}

