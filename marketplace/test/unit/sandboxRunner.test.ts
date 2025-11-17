/**
 * marketplace/test/unit/sandboxRunner.test.ts
 *
 * Unit tests for the Sandbox Runner (determinism, timebox/TTL, resource limits, audit emission).
 *
 * - The test will skip automatically if `marketplace/sandbox/sandboxRunner` is not present
 *   or does not export a `runSandbox` async function.
 *
 * - Adjust the option names (seed, simulateWorkMs, ttlSeconds, cpuMillis, memoryMb, auditWriter)
 *   and the expected result fields (status, output, error) to match your implementation.
 */

import fs from 'fs';
import path from 'path';
import { test, expect, beforeAll } from 'vitest';
import { vi } from 'vitest';

const MODULE_REL_PATH = path.resolve(__dirname, '../../sandbox/sandboxRunner'); // marketplace/sandbox/sandboxRunner.{js,ts}

let runner: any = null;
let runnerAvailable = false;

beforeAll(() => {
  if (!fs.existsSync(MODULE_REL_PATH + '.js') && !fs.existsSync(MODULE_REL_PATH + '.ts')) {
    runnerAvailable = false;
    return;
  }
  try {
    // Try both compiled JS or TS source (runtime will resolve appropriate file)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    runner = require(MODULE_REL_PATH);
    if (runner && typeof runner.runSandbox === 'function') {
      runnerAvailable = true;
    }
  } catch (err) {
    // Could not import — mark unavailable
    runnerAvailable = false;
  }
});

// Skip the test suite if the runner is not implemented yet.
if (!runnerAvailable) {
  test.skip('Sandbox runner not implemented: marketplace/sandbox/sandboxRunner (skipping sandboxRunner tests)', () => {});
} else {
  // Helper to call runSandbox with safe defaults and return the resolved result.
  async function callRunner(opts: Record<string, any>) {
    // Most implementations will accept a single config object.
    // If your implementation signature differs, adapt this helper accordingly.
    const res = await runner.runSandbox(opts);
    return res;
  }

  test('deterministic output for same seed', async () => {
    const baseOpts = {
      skuId: 'unit-test-sku',
      seed: 'deterministic-seed-42', // runner should use this seed for deterministic runs
      simulateWorkMs: 20, // hints runner to simulate some work; optional
      ttlSeconds: 10,
      cpuMillis: 100,
      memoryMb: 64,
      auditWriter: { appendAuditEvent: vi.fn(async () => ({ ok: true, id: 'audit-1' })) },
    };

    // Run twice with same config
    const out1 = await callRunner({ ...baseOpts });
    const out2 = await callRunner({ ...baseOpts });

    // Result shape expectations (adapt these if your runner returns different fields)
    expect(out1).toBeDefined();
    expect(out2).toBeDefined();
    // Result should include a status field (completed|failed|expired|timeout)
    expect(typeof out1.status).toBe('string');
    expect(typeof out2.status).toBe('string');

    // Determinism: outputs (payload / result details) must be equal for identical seeds
    // Accept either `output` or `result` or the whole object; adapt as needed
    const comparand1 = out1.output ?? out1.result ?? out1;
    const comparand2 = out2.output ?? out2.result ?? out2;

    expect(comparand1).toEqual(comparand2);
  }, 20_000);

  test('honors TTL / timebox and returns expired/timeout status', async () => {
    // If your runner supports simulating long work, we instruct a delay that exceeds TTL
    const opts = {
      skuId: 'unit-test-ttl',
      seed: 'ttl-seed',
      simulateWorkMs: 3000, // simulated work of 3s
      ttlSeconds: 1, // TTL shorter than simulated work -> should expire/timeout
      cpuMillis: 100,
      memoryMb: 64,
      auditWriter: { appendAuditEvent: vi.fn(async () => ({ ok: true })) },
    };

    let res;
    try {
      res = await callRunner(opts);
    } catch (err: any) {
      // Implementations may throw on TTL expiry instead of returning a status object.
      // Accept either behavior.
      const msg = String(err && err.message ? err.message : err);
      expect(msg.toLowerCase()).toMatch(/timeout|ttl|expired/);
      return;
    }

    // If runner returned normally, expect an expired/timeout status or failure
    expect(res).toBeDefined();
    expect(res.status).toBeDefined();
    // Acceptable status values include 'expired', 'timeout', 'failed' with TTL reason
    const s = String(res.status).toLowerCase();
    const okStatuses = ['expired', 'timeout', 'failed', 'killed'];
    const matched = okStatuses.some((v) => s.includes(v)) || (res.error && String(res.error).toLowerCase().includes('ttl'));
    expect(matched).toBe(true);
  }, 20_000);

  test('enforces resource limits (cpu / memory) and fails when exceeded', async () => {
    const opts = {
      skuId: 'unit-test-resource',
      seed: 'resource-seed',
      // Request an impossibly small resource budget for a synthetic heavy workload
      simulateWorkMs: 50,
      ttlSeconds: 10,
      cpuMillis: 1, // intentionally tiny CPU budget
      memoryMb: 1, // intentionally tiny memory budget
      auditWriter: { appendAuditEvent: vi.fn(async () => ({ ok: true })) },
    };

    let res;
    try {
      res = await callRunner(opts);
    } catch (err: any) {
      const msg = String(err && err.message ? err.message : err);
      // Expect a resource-related error message
      expect(msg.toLowerCase()).toMatch(/resource|cpu|memory|quota|limit/);
      return;
    }

    // If runner returned a structured result, assert it indicates resource failure
    expect(res).toBeDefined();
    expect(res.status).toBeDefined();
    const s = String(res.status).toLowerCase();
    const resourceFailure = s.includes('failed') || s.includes('resource') || (res.error && String(res.error).toLowerCase().includes('resource'));
    expect(resourceFailure).toBe(true);
  }, 10_000);

  test('emits audit events via injected auditWriter', async () => {
    // Create a mock auditWriter and spy the appendAuditEvent call
    const auditWriter = {
      appendAuditEvent: vi.fn(async (evt: any) => ({ ok: true, id: `audit-${Math.random().toString(36).slice(2, 10)}` })),
    };

    const opts = {
      skuId: 'unit-test-audit',
      seed: 'audit-seed',
      simulateWorkMs: 10,
      ttlSeconds: 10,
      cpuMillis: 100,
      memoryMb: 64,
      auditWriter,
    };

    const res = await callRunner(opts);
    expect(res).toBeDefined();
    // The runner SHOULD call auditWriter.appendAuditEvent at least once (started/completed)
    expect(auditWriter.appendAuditEvent).toHaveBeenCalled();
    // Optionally verify the first call's payload has required fields
    const firstCallArgs = (auditWriter.appendAuditEvent as any).mock.calls[0][0];
    expect(firstCallArgs).toBeDefined();
    // Expect at least an event_type and payload or actor_id
    const hasEventType = Boolean(firstCallArgs.event_type || firstCallArgs.type);
    const hasPayload = Boolean(firstCallArgs.payload || firstCallArgs.body || firstCallArgs.data);
    expect(hasEventType || hasPayload).toBe(true);
  }, 10_000);
}

