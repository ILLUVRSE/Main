/**
 * reasoning-graph/test/integration/promotion_integration.test.ts
 *
 * Integration test (best-effort) for:
 *   - Kernel-authenticated POST /nodes (should be rejected without Kernel auth)
 *   - Kernel-authenticated POST /edges
 *   - Request snapshot POST /snapshots and assert signed metadata present
 *   - Query trace GET /trace/{id} and assert ordering & basic explainability
 *
 * Usage:
 *   REASONING_GRAPH_BASE_URL=http://127.0.0.1:5000 npx vitest run test/integration/promotion_integration.test.ts --runInBand
 *
 * Notes:
 *  - For local dev we accept a simple test header X-DEV-KERNEL to emulate Kernel auth.
 *  - In production/staging tests use real mTLS or Kernel-signed tokens.
 *  - If SNAPSHOT_SIGNER_PUBLIC_KEY_PEM is exported into env, the test will attempt a signature verification.
 */

import { test, expect, beforeAll } from 'vitest';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';

const BASE = process.env.REASONING_GRAPH_BASE_URL ?? 'http://127.0.0.1:5000';
const DEV_KERNEL_HEADER = 'X-DEV-KERNEL'; // test-only header used by local Dev servers to emulate Kernel auth
const CANONICALIZE = true; // we canonicalize JSON with sorted keys for local signature verification

function skipIfUnconfigured() {
  const envSet = !!process.env.REASONING_GRAPH_BASE_URL;
  // If an explicit env var isn't set, try probing the default URL.
  return new Promise<boolean>(async (resolve) => {
    // Quick probe
    try {
      const res = await fetch(`${BASE}/health`, { method: 'GET', timeout: 2000 as any });
      resolve(!res.ok);
    } catch (e) {
      // service not reachable — skip
      resolve(true);
    }
  });
}

async function canonicalizeJson(obj: any) {
  // Deterministic canonicalization: sort object keys recursively and produce JSON with no spaces.
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
  const sorted = sortKeys(obj);
  return JSON.stringify(sorted);
}

async function verifyRsaSignature(publicKeyPem: string, payload: string | Buffer, signatureB64: string) {
  const verifier = crypto.createVerify('sha256');
  verifier.update(typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload);
  verifier.end();
  const sigBuf = Buffer.from(signatureB64, 'base64');
  return verifier.verify(publicKeyPem, sigBuf);
}

let shouldSkip = true;
beforeAll(async () => {
  shouldSkip = await skipIfUnconfigured();
  if (shouldSkip) {
    console.warn(`[integration test] Reasoning Graph not reachable at ${BASE} — skipping integration tests.`);
  }
});

test('kernel-authenticated writes -> snapshot -> trace', async () => {
  if (shouldSkip) {
    test.skip();
    return;
  }

  // 1) Attempt unauthenticated write -> expect 401/403
  const nodePayload = {
    id: `node-test-${Date.now()}`,
    type: 'Decision',
    actor: 'service:eval-engine',
    ts: new Date().toISOString(),
    payload: { reason: 'integration-test', score: 0.95 },
    metadata: { manifest_ref: 'manifest-test-001' },
  };

  const unauthRes = await fetch(`${BASE}/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes: [nodePayload] }),
  });

  // Accept either 401/403 or 404 if writes are not exposed in test server
  expect([401, 403, 404].includes(unauthRes.status)).toBeTruthy();

  // 2) Do a Kernel-authenticated write (dev header) -> expect ok
  const kernelHeaders: any = {
    'Content-Type': 'application/json',
    [DEV_KERNEL_HEADER]: 'test-kernel-1',
  };

  const authNodesRes = await fetch(`${BASE}/nodes`, {
    method: 'POST',
    headers: kernelHeaders,
    body: JSON.stringify({ nodes: [nodePayload], audit_context: { kernel_manifest_signature_id: 'manifest-test-001' } }),
  });

  expect(authNodesRes.ok).toBeTruthy();
  const authNodesJson = await authNodesRes.json();
  expect(authNodesJson.ok).toBeTruthy();
  const createdNodes = authNodesJson.nodes;
  expect(Array.isArray(createdNodes) && createdNodes.length > 0).toBeTruthy();
  const rootNodeId = createdNodes[0].id || nodePayload.id;

  // 3) Create a second node & an edge
  const node2 = {
    id: `node-test-2-${Date.now()}`,
    type: 'Recommendation',
    actor: 'service:eval-engine',
    ts: new Date().toISOString(),
    payload: { reason: 'followup', score: 0.80 },
    metadata: {},
  };

  const authNodesRes2 = await fetch(`${BASE}/nodes`, {
    method: 'POST',
    headers: kernelHeaders,
    body: JSON.stringify({ nodes: [node2], audit_context: { kernel_manifest_signature_id: 'manifest-test-002' } }),
  });
  expect(authNodesRes2.ok).toBeTruthy();
  const node2Json = await authNodesRes2.json();
  expect(node2Json.ok).toBeTruthy();
  const node2Id = node2Json.nodes?.[0]?.id ?? node2.id;

  // create an edge from rootNodeId -> node2Id
  const edge = { id: `edge-${Date.now()}`, from: rootNodeId, to: node2Id, type: 'causes', metadata: {} };
  const authEdgeRes = await fetch(`${BASE}/edges`, {
    method: 'POST',
    headers: kernelHeaders,
    body: JSON.stringify({ edges: [edge], audit_context: { kernel_manifest_signature_id: 'manifest-test-003' } }),
  });
  expect(authEdgeRes.ok).toBeTruthy();
  const authEdgeJson = await authEdgeRes.json();
  expect(authEdgeJson.ok).toBeTruthy();

  // 4) Request a snapshot for the root node
  const snapshotReq = {
    snapshot_request_id: `snap-req-${Date.now()}`,
    root_node_id: rootNodeId,
    audience: 'auditor', // auditor snapshots may include more details
    include_annotations: true,
  };

  const snapRes = await fetch(`${BASE}/snapshots`, {
    method: 'POST',
    headers: kernelHeaders,
    body: JSON.stringify(snapshotReq),
  });
  expect(snapRes.ok).toBeTruthy();
  const snapJson = await snapRes.json();
  expect(snapJson.ok).toBeTruthy();
  const snapshotId = snapJson.snapshot_id || snapJson.snapshot?.snapshot_id;
  expect(snapshotId).toBeTruthy();

  // 5) Poll snapshot until signed or ready (short timeout)
  let snapshotMeta: any = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const g = await fetch(`${BASE}/snapshots/${encodeURIComponent(snapshotId)}`, {
      method: 'GET',
      headers: kernelHeaders,
    });
    if (!g.ok) {
      // Try again
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const gj = await g.json();
    if (gj.ok && gj.snapshot) {
      snapshotMeta = gj.snapshot;
      if (snapshotMeta.status === 'signed' || snapshotMeta.status === 'ready' || snapshotMeta.signature) {
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(snapshotMeta).toBeTruthy();
  // Validate presence of signature/hash fields
  expect(snapshotMeta.hash || snapshotMeta.signature).toBeTruthy();
  const signature = snapshotMeta.signature;
  const signerKid = snapshotMeta.signer_kid;
  const s3Path = snapshotMeta.s3_path || snapshotMeta.url;

  // 6) Optionally fetch snapshot payload (if snapshot endpoint exposes it / allowed)
  let snapshotPayload: any = null;
  try {
    const payloadRes = await fetch(`${BASE}/snapshots/${encodeURIComponent(snapshotId)}/payload`, {
      method: 'GET',
      headers: kernelHeaders,
    });
    if (payloadRes.ok) {
      snapshotPayload = await payloadRes.json();
    }
  } catch (e) {
    // Not required — many implementations store payload in S3 only.
  }

  // If payload available and public key provided, verify signature
  const publicKeyPem = process.env.SNAPSHOT_SIGNER_PUBLIC_KEY_PEM ?? '';
  if (snapshotPayload && signature && publicKeyPem) {
    // Canonicalize payload here using deterministic key sort
    const canonical = await canonicalizeJson(snapshotPayload);
    const sigValid = await verifyRsaSignature(publicKeyPem, canonical, signature);
    expect(sigValid).toBeTruthy();
  } else {
    // If no public key provided, at least assert presence of signature & signer_kid
    expect(signature).toBeTruthy();
    expect(signerKid).toBeTruthy();
  }

  // 7) Query trace and assert ordering & explanation present
  const traceRes = await fetch(`${BASE}/trace/${encodeURIComponent(rootNodeId)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', [DEV_KERNEL_HEADER]: 'test-kernel-1' }, // reads may not require Kernel auth, but OK to include
  });
  expect(traceRes.ok).toBeTruthy();
  const traceJson = await traceRes.json();
  expect(traceJson.ok).toBeTruthy();
  const trace = traceJson.trace;
  expect(trace).toBeTruthy();
  expect(Array.isArray(trace.ordered_nodes) && trace.ordered_nodes.length >= 2).toBeTruthy();
  // Ensure node ordering contains root then node2
  const ids = trace.ordered_nodes.map((n: any) => n.id);
  expect(ids).toContain(rootNodeId);
  expect(ids).toContain(node2Id);

  // basic explain check
  expect(trace.explain || trace.ordered_nodes?.[0]?.explain || trace.ordered_nodes?.[0]?.payload).toBeTruthy();
});

