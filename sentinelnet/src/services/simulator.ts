// sentinelnet/src/services/simulator.ts
/**
 * simulator.ts
 *
 * Lightweight simulation runner: runs a policy against a sample of audit/context events
 * and produces an impact report (matches, match rate, and sample examples).
 *
 * Notes:
 *  - This is a best-effort simulator: Kernel must expose a simple audit search or you may
 *    provide `sampleEvents` in options. Without ground-truth labels we cannot compute
 *    false-positive/false-negative rates; we return match statistics and examples.
 */

import axios from 'axios';
import logger from '../logger';
import policyStore from './policyStore';
import evaluator from '../evaluator';
import { loadConfig } from '../config/env';

const config = loadConfig();

export interface SimulationOptions {
  sampleSize?: number;
  // Optional: caller can provide sample events directly to avoid Kernel dependency.
  sampleEvents?: any[];
  // Optional filter criteria when fetching events from Kernel (e.g., time range)
  fetchFilter?: Record<string, any>;
}

export interface SimulationReport {
  policyId: string;
  policyName?: string;
  policyVersion?: number;
  sampleSize: number;
  matched: number;
  matchRate: number; // matched / sampleSize
  examples: { event: any; evalResult: any }[]; // up to 10
  note?: string;
}

/**
 * Try to fetch sample audit/context events from Kernel.
 * This is a best-effort helper that POSTs to /kernel/audit/search if available.
 */
async function fetchSampleEventsFromKernel(filter: Record<string, any> | undefined, limit = 500): Promise<any[]> {
  const kernelBase = config.kernelAuditUrl || process.env.KERNEL_AUDIT_URL || '';
  if (!kernelBase) {
    logger.info('fetchSampleEventsFromKernel: KERNEL_AUDIT_URL not configured');
    return [];
  }

  try {
    const url = `${kernelBase.replace(/\/$/, '')}/kernel/audit/search`;
    const resp = await axios.post(url, { ...filter, limit });
    // Expecting resp.data.events or plain array
    if (Array.isArray(resp.data)) return resp.data;
    if (resp.data && Array.isArray(resp.data.events)) return resp.data.events;
    logger.debug('fetchSampleEventsFromKernel: unexpected response shape', { data: resp.data });
    return [];
  } catch (err) {
    logger.warn('fetchSampleEventsFromKernel failed', { error: (err as Error).message || err });
    return [];
  }
}

/**
 * Run a simulation for a policy id.
 */
export async function runSimulation(policyId: string, opts: SimulationOptions = {}): Promise<SimulationReport> {
  const sampleSize = opts.sampleSize ?? 500;
  const policy = await policyStore.getPolicyById(policyId);
  if (!policy) {
    throw new Error('policy_not_found');
  }

  // Acquire sample events
  let samples: any[] = [];
  if (Array.isArray(opts.sampleEvents) && opts.sampleEvents.length) {
    samples = opts.sampleEvents.slice(0, sampleSize);
  } else {
    // Attempt to fetch from Kernel audit search / fallback to empty array
    samples = (await fetchSampleEventsFromKernel(opts.fetchFilter, sampleSize)).slice(0, sampleSize);
  }

  if (!samples.length) {
    return {
      policyId: policy.id,
      policyName: policy.name,
      policyVersion: policy.version,
      sampleSize: 0,
      matched: 0,
      matchRate: 0,
      examples: [],
      note: 'No sample events available (provide sampleEvents or configure KERNEL_AUDIT_URL).',
    };
  }

  // Evaluate each sample: prepare a compact input object expected by evaluator
  let matchedCount = 0;
  const examples: { event: any; evalResult: any }[] = [];

  for (const ev of samples) {
    // Build data blob. Expect audit event payload or similar structures.
    const data = {
      // best-effort mappings; caller/sample should conform to expected shape
      action: ev?.payload?.action ?? ev?.payload?.type ?? ev?.type ?? null,
      actor: ev?.payload?.principal ?? ev?.payload?.actor ?? ev?.principal ?? null,
      resource: ev?.payload?.resource ?? null,
      context: ev?.payload ?? ev,
      // include raw audit meta for traceability
      _audit_meta: {
        id: ev?.id ?? null,
        eventType: ev?.eventType ?? ev?.type ?? null,
        ts: ev?.ts ?? ev?.createdAt ?? null,
      },
    };

    try {
      const res = await evaluator.evaluate(policy.rule, data);
      if (res && res.match) {
        matchedCount++;
        if (examples.length < 10) {
          examples.push({ event: ev, evalResult: res });
        }
      }
    } catch (err) {
      logger.warn('simulation evaluation error', { policyId: policy.id, error: (err as Error).message || err });
      // continue
    }
  }

  const report: SimulationReport = {
    policyId: policy.id,
    policyName: policy.name,
    policyVersion: policy.version,
    sampleSize: samples.length,
    matched: matchedCount,
    matchRate: samples.length ? matchedCount / samples.length : 0,
    examples,
  };

  return report;
}

export default {
  runSimulation,
};

