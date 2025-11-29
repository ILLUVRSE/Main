
import * as crypto from 'crypto';

const BASE = process.env.REASONING_GRAPH_BASE_URL ?? 'http://127.0.0.1:5000';
const DEV_KERNEL_HEADER = 'X-DEV-KERNEL';

// Helpers to create random IDs
const randomId = () => crypto.randomUUID();

function skipIfUnconfigured() {
  const envSet = !!process.env.REASONING_GRAPH_BASE_URL;
  return new Promise<boolean>(async (resolve) => {
    try {
      const res = await fetch(`${BASE}/health`, { method: 'GET' });
      resolve(!res.ok);
    } catch (e) {
      resolve(true);
    }
  });
}

let shouldSkip = true;
beforeAll(async () => {
  shouldSkip = await skipIfUnconfigured();
  if (shouldSkip) {
    console.warn(`[integration test] Reasoning Graph not reachable at ${BASE} — skipping trace ordering tests.`);
  }
});

async function createNode(id: string, type = 'decision', payload = {}) {
  const res = await fetch(`${BASE}/reason/node`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [DEV_KERNEL_HEADER]: 'test-kernel',
    },
    body: JSON.stringify({
      type,
      payload: { ...payload, id }, // payload.id is just for reference
      author: 'test-agent',
      auditEventId: `audit-${randomId()}`,
      metadata: { created_for_trace: true }
    })
  });
  if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Failed to create node ${id}: ${res.status} ${txt}`);
  }
  return id;
}

async function createEdge(from: string, to: string, type = 'causal') {
  const res = await fetch(`${BASE}/reason/edge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [DEV_KERNEL_HEADER]: 'test-kernel',
    },
    body: JSON.stringify({
      from,
      to,
      type,
      metadata: {},
      auditEventId: `audit-${randomId()}` // Now supported in my code
    })
  });
  if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Failed to create edge ${from}->${to}: ${res.status} ${txt}`);
  }
  const json = await res.json() as any;
  return json.edgeId;
}

test('Trace Correctness: Linear Chain', async () => {
  if (shouldSkip) return;

  const nA = randomId();
  const nB = randomId();
  const nC = randomId();

  // Create A -> B -> C (A causes B, B causes C)
  // We must create them in order or not, timestamps matter.
  // We'll create A, then B, then C.
  await createNode(nA, 'observation', { val: 'A' });
  await new Promise(r => setTimeout(r, 10));
  await createNode(nB, 'decision', { val: 'B' });
  await new Promise(r => setTimeout(r, 10));
  await createNode(nC, 'action', { val: 'C' });

  await createEdge(nA, nB); // A -> B
  await createEdge(nB, nC); // B -> C

  // Get trace for C
  const res = await fetch(`${BASE}/reason/traces/${nC}`, {
    headers: { [DEV_KERNEL_HEADER]: 'test-kernel' }
  });
  expect(res.ok).toBe(true);
  const data = await res.json() as any;

  expect(data.trace_id).toBe(nC);
  expect(data.metadata.cycleDetected).toBe(false);

  // Expected: A, A->B, B, B->C, C
  const path = data.ordered_path;
  expect(path.length).toBe(5);

  const ids = path.map((x: any) => x.id);
  // We don't know edge IDs easily unless we captured them, but we can check node order
  const nodeIds = path.filter((x: any) => x.type === 'node').map((x: any) => x.id);
  expect(nodeIds).toEqual([nA, nB, nC]);

  // Check audit refs
  path.filter((x: any) => x.type === 'node').forEach((x: any) => {
    expect(x.auditRef).toBeDefined();
    expect(x.auditRef.eventId).toContain('audit-');
  });
});

test('Trace Correctness: Cycle Detection', async () => {
    if (shouldSkip) return;

    const nA = randomId();
    const nB = randomId();

    // A -> B -> A
    await createNode(nA);
    await createNode(nB);

    await createEdge(nA, nB);
    await createEdge(nB, nA);

    const res = await fetch(`${BASE}/reason/traces/${nB}`, {
        headers: { [DEV_KERNEL_HEADER]: 'test-kernel' }
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as any;

    expect(data.metadata.cycleDetected).toBe(true);
    // Should still return all items
    const nodeIds = data.ordered_path.filter((x: any) => x.type === 'node').map((x: any) => x.id);
    expect(nodeIds).toContain(nA);
    expect(nodeIds).toContain(nB);
});
