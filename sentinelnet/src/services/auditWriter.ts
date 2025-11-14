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

function resolveKernelAuditBase(): string {
  return (config.kernelAuditUrl || process.env.KERNEL_AUDIT_URL || '').replace(/\/$/, '');
}

function buildHttpsAgent(skipMtls: boolean): https.Agent | undefined {
  const certPath = process.env.KERNEL_MTLS_CERT_PATH;
  const keyPath = process.env.KERNEL_MTLS_KEY_PATH;
  const caPath = process.env.KERNEL_MTLS_CA_PATH;
  if (skipMtls || !certPath || !keyPath) {
    if (skipMtls) {
      logger.debug('auditWriter: DEV_SKIP_MTLS enabled; not configuring mTLS agent');
    }
    return undefined;
  }
  try {
    const cert = fs.readFileSync(certPath);
    const key = fs.readFileSync(keyPath);
    const ca = caPath ? fs.readFileSync(caPath) : undefined;
    return new https.Agent({
      cert,
      key,
      ca,
      keepAlive: true,
      rejectUnauthorized: Boolean(caPath),
    });
  } catch (err) {
    logger.warn('auditWriter: failed to read mTLS cert/key/ca; falling back to non-mTLS', {
      err: (err as Error).message || err,
    });
    return undefined;
  }
}

let cachedHttp: AxiosInstance | null = null;
let cachedBase = '';

function getHttp(): AxiosInstance | null {
  const baseURL = resolveKernelAuditBase();
  if (!baseURL) {
    return null;
  }
  if (cachedHttp && cachedBase === baseURL) {
    return cachedHttp;
  }

  const skipMtls = config.devSkipMtls || process.env.DEV_SKIP_MTLS === 'true';
  const httpsAgent = buildHttpsAgent(skipMtls);
  cachedHttp = axios.create({
    baseURL,
    httpsAgent,
    timeout: 5000,
    validateStatus: (s) => s >= 200 && s < 300,
  });
  cachedBase = baseURL;
  return cachedHttp;
}

// test helper
export function __resetHttpClientForTest() {
  cachedHttp = null;
  cachedBase = '';
}

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
  const kernelUrl = resolveKernelAuditBase();
  if (!kernelUrl) {
    logger.warn('appendPolicyDecision: kernel audit URL not configured; skipping audit append', {
      policyId,
      decision: meta?.decision,
    });
    return null;
  }
  const http = getHttp();
  if (!http) {
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
  __resetHttpClientForTest,
};
