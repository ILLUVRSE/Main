// sentinelnet/src/services/auditWriter.ts
/**
 * Writes `policy.decision` audit events to Kernel audit endpoint.
 *
 * Returns the created audit event id (string) when available, or null on failure.
 *
 * This implementation attempts to call Kernel's /kernel/audit endpoint (configured
 * via KERNEL_AUDIT_URL or config.kernelAuditUrl). It supports mTLS by reading
 * KERNEL_MTLS_CERT_PATH / KERNEL_MTLS_KEY_PATH / KERNEL_MTLS_CA_PATH if provided.
 *
 * Note: failures to post audit events are logged but do not throw by default.
 */

import axios, { AxiosInstance } from 'axios';
import https from 'https';
import fs from 'fs';
import logger from '../logger';
import { loadConfig } from '../config/env';

const config = loadConfig();

function makeAxios(): AxiosInstance {
  const baseURL = config.kernelAuditUrl || process.env.KERNEL_AUDIT_URL || '';
  const skipMtls = config.devSkipMtls || process.env.DEV_SKIP_MTLS === 'true';

  let httpsAgent: https.Agent | undefined;
  const certPath = process.env.KERNEL_MTLS_CERT_PATH;
  const keyPath = process.env.KERNEL_MTLS_KEY_PATH;
  const caPath = process.env.KERNEL_MTLS_CA_PATH;

  if (!skipMtls && certPath && keyPath) {
    try {
      const cert = fs.readFileSync(certPath);
      const key = fs.readFileSync(keyPath);
      const ca = caPath ? fs.readFileSync(caPath) : undefined;
      httpsAgent = new https.Agent({
        cert,
        key,
        ca,
        keepAlive: true,
        rejectUnauthorized: Boolean(caPath),
      });
      logger.info('auditWriter: configured mTLS for kernel audit calls');
    } catch (err) {
      logger.warn('auditWriter: failed to read mTLS cert/key/ca; falling back to non-mTLS', {
        err: (err as Error).message || err,
      });
    }
  } else {
    if (!baseURL) {
      logger.warn('auditWriter: no KERNEL_AUDIT_URL configured; audit posts will be skipped');
    }
    if (skipMtls) {
      logger.info('auditWriter: DEV_SKIP_MTLS enabled; skipping mTLS');
    }
  }

  const instance = axios.create({
    baseURL: baseURL || undefined,
    httpsAgent,
    timeout: 5000,
    validateStatus: (s) => s >= 200 && s < 300, // accept 2xx incl. 202
  });

  return instance;
}

const http = makeAxios();

/**
 * Shape of the metadata passed from decisionService
 */
export interface PolicyDecisionMeta {
  decision: 'allow' | 'deny' | 'quarantine' | 'remediate';
  allowed: boolean;
  policyId: string | null;
  policyVersion: number | null;
  ruleId?: string | null;
  rationale?: string | null;
  evidenceRefs?: string[]; // optional evidence refs
  ts?: string;
}

/**
 * Append a policy.decision audit event to Kernel.
 * Returns the created audit event id string on success, otherwise null.
 */
export async function appendPolicyDecision(
  policyId: string | null,
  ctxData: any,
  meta: PolicyDecisionMeta,
): Promise<string | null> {
  const kernelUrl = config.kernelAuditUrl || process.env.KERNEL_AUDIT_URL || '';
  if (!kernelUrl) {
    logger.warn('appendPolicyDecision: kernel audit URL not configured; skipping audit append', {
      policyId,
      decision: meta?.decision,
    });
    return null;
  }

  const eventType = 'policy.decision';
  const payload: Record<string, any> = {
    policy: meta.policyId ?? policyId ?? null,
    decision: {
      id: meta.ruleId ?? `${meta.policyId ?? 'unknown'}:${meta.decision}`,
      decision: meta.decision,
      allowed: Boolean(meta.allowed),
      policyVersion: meta.policyVersion ?? null,
      ruleId: meta.ruleId ?? null,
      rationale: meta.rationale ?? null,
      evidenceRefs: meta.evidenceRefs ?? [],
      ts: meta.ts ?? new Date().toISOString(),
    },
  };

  // include principal summary if present in ctxData
  if (ctxData?.actor) {
    payload['principal'] = {
      id: ctxData.actor?.id ?? null,
      type: ctxData.actor?.type ?? null,
      roles: Array.isArray(ctxData.actor?.roles) ? ctxData.actor.roles : [],
    };
  }

  // include action/resource/context summary (keep it compact)
  payload['context'] = {
    action: ctxData.action ?? null,
    resource: ctxData.resource ?? null,
    sampleContext: ctxData.context ?? null,
  };

  try {
    const res = await http.post('/kernel/audit', { eventType, payload });
    // kernel returns 202 with body = ev (per kernel audit handler)
    const ev = res.data;
    if (ev && ev.id) {
      logger.info('appendPolicyDecision: audit event appended', { id: ev.id });
      return String(ev.id);
    } else {
      logger.warn('appendPolicyDecision: audit response missing id', { resp: ev });
      return null;
    }
  } catch (err) {
    logger.warn('appendPolicyDecision: failed to post audit event', {
      error: (err as Error).message || err,
      eventType,
      policyId,
    });
    return null;
  }
}

export default {
  appendPolicyDecision,
};

