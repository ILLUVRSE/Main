/**
 * marketplace/sandbox/sandboxRunner.ts
 *
 * Exports: async function runSandbox(opts)
 *
 * Expected opts:
 * {
 *   skuId: string,
 *   seed?: string,
 *   simulateWorkMs?: number,
 *   ttlSeconds?: number,
 *   cpuMillis?: number,
 *   memoryMb?: number,
 *   auditWriter?: { appendAuditEvent: async (evt) => ... }
 * }
 *
 * The function is deterministic for a given seed + skuId and returns an object:
 * { session_id, endpoint, started_at, expires_at, status, output }
 *
 * The tests accept either throwing on TTL/resource failure or returning a status
 * (we return expired for TTL overrun, throw for resource failure).
 */

import crypto from 'crypto';

export type SandboxOpts = {
  skuId: string;
  seed?: string;
  simulateWorkMs?: number;
  ttlSeconds?: number;
  cpuMillis?: number;
  memoryMb?: number;
  auditWriter?: { appendAuditEvent?: (evt: any) => Promise<any> };
};

function seededRng(seed: string) {
  let counter = 0;
  return function () {
    const input = `${seed}:${counter++}`;
    const hash = crypto.createHash('sha256').update(input, 'utf8').digest();
    // Use first 4 bytes as uint32
    const val = hash.readUInt32BE(0);
    return val / 0xffffffff;
  };
}

function deterministicId(seed: string, skuId: string) {
  const h = crypto.createHash('sha256').update(`${seed}::${skuId}`, 'utf8').digest('hex');
  return `preview-${h.slice(0, 16)}`;
}

function isoNow() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runSandbox(opts: SandboxOpts) {
  if (!opts || !opts.skuId) {
    throw new Error('runSandbox requires opts.skuId');
  }

  const skuId = String(opts.skuId);
  const seed = String(opts.seed ?? `seed:${skuId}`);
  const simulateWorkMs = Number(opts.simulateWorkMs ?? 10); // small default
  const ttlSeconds = Number(opts.ttlSeconds ?? 10); // default 10s TTL
  const cpuMillis = Number(opts.cpuMillis ?? 100); // default budget
  const memoryMb = Number(opts.memoryMb ?? 64); // default memory budget
  const auditWriter = opts.auditWriter;

  // Deterministic identifiers
  const session_id = deterministicId(seed, skuId);
  const endpoint = `wss://sandbox.local/sessions/${session_id}`;
  const started_at = isoNow();
  const expiresAtDate = new Date(Date.now() + ttlSeconds * 1000);
  const expires_at = expiresAtDate.toISOString();

  // Create deterministic output using seed-based RNG
  const rng = seededRng(`${seed}::${skuId}::runner`);
  const deterministicOutput = {
    // produce a couple of deterministic values that don't include timestamps
    deterministic_value: Math.floor(rng() * 1_000_000),
    skuId,
    seed,
  };

  // Emit preview.started audit event if writer present
  const emitStarted = async () => {
    if (auditWriter && typeof auditWriter.appendAuditEvent === 'function') {
      try {
        await auditWriter.appendAuditEvent({
          actor_id: `sandbox-runner:${session_id}`,
          event_type: 'preview.started',
          payload: {
            session_id,
            sku_id: skuId,
            started_at,
            expires_at,
            seed,
          },
          created_at: started_at,
        });
      } catch (e) {
        // best-effort
        // eslint-disable-next-line no-console
        console.debug('auditWriter.appendAuditEvent(preview.started) failed:', (e as Error).message);
      }
    }
  };

  // Emit preview.completed audit event if writer present
  const emitCompleted = async (status: string, additionalPayload: any = {}) => {
    if (auditWriter && typeof auditWriter.appendAuditEvent === 'function') {
      try {
        await auditWriter.appendAuditEvent({
          actor_id: `sandbox-runner:${session_id}`,
          event_type: 'preview.completed',
          payload: {
            session_id,
            sku_id: skuId,
            status,
            ...additionalPayload,
          },
          created_at: isoNow(),
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.debug('auditWriter.appendAuditEvent(preview.completed) failed:', (e as Error).message);
      }
    }
  };

  // Resource limit heuristic:
  // require cpuMillis >= ceil(simulateWorkMs / 10) and memoryMb >= ceil(simulateWorkMs / 10)
  const required = Math.max(1, Math.ceil(simulateWorkMs / 10));
  if (cpuMillis < required || memoryMb < required) {
    // Fail fast with a resource-related error (tests accept thrown error with message containing 'resource' or 'cpu'/'memory')
    throw new Error(`resource: cpu/memory limits exceeded (cpuMillis=${cpuMillis}, memoryMb=${memoryMb}, required=${required})`);
  }

  // Start session
  await emitStarted();

  // If requested work exceeds TTL, return expired result (tests accept expired or thrown)
  if (simulateWorkMs > ttlSeconds * 1000) {
    const status = 'expired';
    // emit completed/expired audit
    await emitCompleted(status, { reason: 'TTL_EXCEEDED', simulateWorkMs });
    return {
      session_id,
      endpoint,
      started_at,
      expires_at,
      status,
      output: deterministicOutput,
    };
  }

  // Simulate work
  try {
    if (simulateWorkMs > 0) {
      // Do small incremental sleeps in case we want to be responsive
      const chunk = 50;
      let remaining = simulateWorkMs;
      while (remaining > 0) {
        const step = Math.min(chunk, remaining);
        // If the step would push us past expires_at, break and mark expired
        const now = Date.now();
        if (now + step > expiresAtDate.getTime()) {
          // TTL would be exceeded
          await emitCompleted('expired', { reason: 'TTL_EXCEEDED_DURING_WORK', simulateWorkMs, remaining });
          return {
            session_id,
            endpoint,
            started_at,
            expires_at,
            status: 'expired',
            output: deterministicOutput,
          };
        }
        // simulate CPU work; here we just sleep to emulate time used
        // (in a real runner, we'd enforce cpu/memory limits via cgroups)
        // Use a tiny busy-loop if cpuMillis is large? For determinism and speed we avoid busy loops.
        // Sleeping is sufficient for tests.
        // eslint-disable-next-line no-await-in-loop
        await sleep(step);
        remaining -= step;
      }
    }

    // Completed successfully
    const status = 'completed';
    await emitCompleted(status, { simulateWorkMs });
    return {
      session_id,
      endpoint,
      started_at,
      expires_at,
      status,
      output: deterministicOutput,
    };
  } catch (err: any) {
    // If anything fails, emit failed audit and return failure status
    await emitCompleted('failed', { error: String(err) });
    return {
      session_id,
      endpoint,
      started_at,
      expires_at,
      status: 'failed',
      output: deterministicOutput,
      error: String(err),
    };
  }
}

export default {
  runSandbox,
};

