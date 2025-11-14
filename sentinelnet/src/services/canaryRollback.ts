import logger from '../logger';
import { Policy } from '../models/policy';
import { loadConfig } from '../config/env';
import canary from './canary';

interface PolicyStats {
  samples: number[];
  lastRollbackTs: number;
}

const stats = new Map<string, PolicyStats>();

function getStats(policyId: string): PolicyStats {
  if (!stats.has(policyId)) {
    stats.set(policyId, { samples: [], lastRollbackTs: 0 });
  }
  return stats.get(policyId)!;
}

export async function recordDecision(policy: Policy, opts: { enforced: boolean; allowed: boolean; effect: string }) {
  const config = loadConfig();
  if (!config.canaryAutoRollbackEnabled) {
    return;
  }

  if (policy.state !== 'canary') {
    return;
  }

  const failureDetected = Boolean(opts.enforced && !opts.allowed && opts.effect !== 'allow');
  const policyStats = getStats(policy.id);

  policyStats.samples.push(failureDetected ? 1 : 0);
  if (policyStats.samples.length > config.canaryRollbackWindow) {
    policyStats.samples.shift();
  }

  if (Date.now() - policyStats.lastRollbackTs < config.canaryRollbackCooldownMs) {
    return;
  }

  if (policyStats.samples.length < config.canaryRollbackWindow) {
    return;
  }

  const failureRate =
    policyStats.samples.reduce((acc, value) => acc + value, 0) / (policyStats.samples.length || 1);

  if (failureRate >= config.canaryRollbackThreshold) {
    try {
      await canary.stopCanary(policy.id, false, 'canary-auto-rollback');
      policyStats.samples = [];
      policyStats.lastRollbackTs = Date.now();
      logger.warn('Canary auto rollback executed', {
        policyId: policy.id,
        failureRate,
        threshold: config.canaryRollbackThreshold,
      });
    } catch (err) {
      logger.warn('Failed to auto rollback canary policy', {
        policyId: policy.id,
        err: (err as Error).message || err,
      });
    }
  }
}

export default {
  recordDecision,
};
