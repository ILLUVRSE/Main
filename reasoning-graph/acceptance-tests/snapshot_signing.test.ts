/**
 * reasoning-graph/acceptance-tests/snapshot_signing.test.ts
 *
 * Acceptance test: verify snapshot is canonicalized and signed correctly.
 *
 * Usage:
 *   REASONING_GRAPH_BASE_URL=http://127.0.0.1:5000 SNAPSHOT_SIGNER_PUBLIC_KEY_PEM="$(cat /tmp/pub.pem)" npx vitest run acceptance-tests/snapshot_signing.test.ts --runInBand
 *
 * Notes:
 *  - In local dev, the test uses a dev Kernel header X-DEV-KERNEL to emulate Kernel-authenticated writes.
 *  - In staging, provide real Kernel auth (mTLS or bearer) by modifying kernelHeaders.
 *  - The test requires node-fetch and crypto (built-in).
 */
import { test, expect, beforeAll } from 'vitest';
import fetch from 'node-fetch';
import * as crypto from 'crypto';

// Configuration from environment
const BASE = process.env.REASONING_GRAPH_BASE_URL ?? 'http://127.0.0.1:5000';
const DEV_KERNEL_HEADER = process.env.DEV_KERNEL_HEADER_NAME ?? 'X-DEV-KERNEL';
const DEV_KERNEL_ID = process.env.DEV_KERNEL_ID ?? 'test-kernel-acceptance';
const SNAPSHOT_SIGNER_PUBLIC_KEY_PEM = process.env.SNAPSHOT_SIGNER_PUBLIC_KEY_PEM ?? '';
const TIMEOUT_MS = 120_000;

async function isServiceReachable() {
  try {
    const r = await fetch(`${BASE}/health`, { method: 'GET', timeout: 2000 as any });
    return r.ok;
  } catch {
    return false;
  }
}

async function canonicalize(obj: any): Promise<string> {
  // Deterministic canonicalization: recursively sort object keys and output compact JSON.
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

function verifyRsaSignature(publicKeyPem: string, message: string | Buffer, signatureB64: string) {
  const verifier = crypto.createVerify('sha256');
  verifier.update(typeof message === 'string' ? Buffer.from(message, 'utf8') : message);
  verifier.end();
  return verifier.verify(publicKeyPem, Buffer.from(signatureB64, 'base64'));
}

let skipSuite = false;
beforeAll(async () => {
  const reachable = await isServiceReachable();
  if (!reachable) {
    // skip if Reasoning Graph not reachable
    console.warn(`[acceptance test] Reasoning Graph not reachable at ${BASE} — skipping snapshot_signing tests.`);
    skipSuite = true;
  }
});

test('snapshot canonicalization parity and signature verification', async () => {
  if (skipSuite) {
    test.skip();
    return;
  }

  // 1) Create minimal Kernel-authenticated nodes and edges
  const nodeA = {
    id: `snap-node-A-${Date.now()}`,
    type: 'Decision',
    actor: 'service:eval-engine',
    ts: new Date().toISOString(),
    payload: { reason: 'acceptance-snapshot', score: 0.91 },
    metadata: { demo: true },
  };
  const nodeB = {
    id: `snap-node-B-${Date.now()}`,
    type: 'Recommendation',
    actor: 'service:eval-engine',
    ts: new Date().toISOString(),
    payload: { reason: 'followup', score: 0.85 },
    metadata: { demo: true },
  };

  const kernelHeaders: any = {
    'Content-Type': 'application/json',
    [DEV_KERNEL_HEADER]: DEV_KERNEL_ID,
  };

  // POST nodes
  const postNodesRes = await fetch(`${BASE}/nodes`, {
    method: 'POST',
    headers: kernelHeaders,
    body: JSON.stringify({ nodes: [nodeA, nodeB], audit_context: { kernel_manifest_signature_id: 'acceptance-manifest' } }),
  });
  expect(postNodesRes.ok).toBeTruthy();
  const postNodesJson = await postNodesRes.json();
  expect(postNodesJson.ok).toBeTruthy();
  const createdNodes = postNodesJson.nodes || [];
  const rootId = createdNodes[0]?.id ?? nodeA.id;
  const secondId = createdNodes[1]?.id ?? nodeB.id;

  // POST an edge
  const edge = { id: `snap-edge-${Date.now()}`, from: rootId, to: secondId, type: 'causes', metadata: {} };
  const postEdgeRes = await fetch(`${BASE}/edges`, {
    method: 'POST',
    headers: kernelHeaders,
    body: JSON.stringify({ edges: [edge], audit_context: { kernel_manifest_signature_id: 'acceptance-manifest' } }),
  });
  expect(postEdgeRes.ok).toBeTruthy();
  const postEdgeJson = await postEdgeRes.json();
  expect(postEdgeJson.ok).toBeTruthy();

  // 2) Request snapshot
  const snapshotReq = {
    snapshot_request_id: `accept-snap-req-${Date.now()}`,
    root_node_id: rootId,
    audience: 'auditor',
    include_annotations: true,
  };
  const snapReqRes = await fetch(`${BASE}/snapshots`, {
    method: 'POST',
    headers: kernelHeaders,
    body: JSON.stringify(snapshotReq),
  });
  expect(snapReqRes.ok).toBeTruthy();
  const snapReqJson = await snapReqRes.json();
  expect(snapReqJson.ok).toBeTruthy();
  const snapshotId = snapReqJson.snapshot_id || snapReqJson.snapshot?.snapshot_id;
  expect(snapshotId).toBeTruthy();

  // 3) Poll snapshot until signed/ready
  let snapshotMeta: any = null;
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const g = await fetch(`${BASE}/snapshots/${encodeURIComponent(snapshotId)}`, {
      method: 'GET',
      headers: kernelHeaders,
    });
    if (!g.ok) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const gj = await g.json();
    if (gj.ok && gj.snapshot) {
      snapshotMeta = gj.snapshot;
      // consider signed if signature present or status signed
      if (snapshotMeta.signature || snapshotMeta.status === 'signed' || snapshotMeta.status === 'ready') break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(snapshotMeta).toBeTruthy();
  expect(snapshotMeta.hash || snapshotMeta.signature).toBeTruthy();
  expect(snapshotMeta.signer_kid).toBeTruthy();

  // 4) Try to fetch payload (many implementations put payload in s3; this is best-effort)
  let payload: any = null;
  try {
    const payloadRes = await fetch(`${BASE}/snapshots/${encodeURIComponent(snapshotId)}/payload`, {
      method: 'GET',
      headers: kernelHeaders,
    });
    if (payloadRes.ok) {
      payload = await payloadRes.json();
    }
  } catch (e) {
    // ignore
  }

  // 5) If payload fetched and public key provided, verify signature over canonicalized payload
  const publicKeyPem = SNAPSHOT_SIGNER_PUBLIC_KEY_PEM;
  if (payload && publicKeyPem) {
    const canonical = await canonicalize(payload);
    // Prefer meta.signature if snapshotMeta.signature present, else signature field in payload
    const signature = snapshotMeta.signature || (payload.signature ?? null);
    expect(signature).toBeTruthy();
    const verified = verifyRsa(publicKeyPem, canonical, signature);
    expect(verified, 'Snapshot signature failed to verify with provided public key').toBeTruthy();
  } else {
    // No payload or no public key: at minimum ensure signature + signer_kid present in metadata
    expect(snapshotMeta.signature || snapshotMeta.hash).toBeTruthy();
    expect(snapshotMeta.signer_kid).toBeTruthy();
  }

  // 6) Basic parity check: request the trace and ensure nodes present & explain exists
  const traceRes = await fetch(`${BASE}/trace/${encodeURIComponent(rootId)}`, {
    method: 'GET',
    headers: kernelHeaders,
  });
  expect(traceRes.ok).toBeTruthy();
  const traceJson = await traceRes.json();
  expect(traceJson.ok).toBeTruthy();
  const trace = traceJson.trace;
  expect(trace).toBeTruthy();
  expect(Array.isArray(trace.ordered_nodes) && trace.ordered_nodes.length >= 2).toBeTruthy();
  const explain = trace.explain || trace.ordered_nodes?.[0]?.explain;
  expect(explain || trace.ordered_nodes[0].payload).toBeTruthy();
}, TIMEOUT_MS);

// helper functions

async function canonicalize(obj: any): Promise<string> {
  // deterministic sort of keys
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

function verifyRsa(pubPem: string, payload: string, signatureB64: string) {
  try {
    const verifier = crypto.createVerify('sha256');
    verifier.update(Buffer.from(payload, 'utf8'));
    verifier.end();
    const sig = Buffer.from(signatureB64, 'base64');
    return verifier.verify(pubPem, sig);
  } catch (e) {
    console.warn('verifyRsa error', e);
    return false;
  }
}

