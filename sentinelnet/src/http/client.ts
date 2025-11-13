// sentinelnet/src/http/client.ts
import axios, { AxiosInstance } from 'axios';
import https from 'https';
import fs from 'fs';
import logger from '../logger';
import { loadConfig } from '../config/env';

const config = loadConfig();

/**
 * Build an Axios instance that can optionally use mTLS when configured.
 * Local/dev may skip mTLS via DEV_SKIP_MTLS or config.devSkipMtls.
 */
function makeAxios(): AxiosInstance {
  const baseURL = config.kernelAuditUrl || process.env.KERNEL_AUDIT_URL || '';
  const skipMtls = config.devSkipMtls || process.env.DEV_SKIP_MTLS === 'true';

  let httpsAgent: https.Agent | undefined = undefined;

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
        rejectUnauthorized: Boolean(caPath), // if no CA provided, still verify via system roots
      });
      logger.info('HTTP client configured with mTLS for Kernel communication');
    } catch (err) {
      logger.warn('Failed to read mTLS cert/key/ca: falling back to non-mTLS axios', {
        err: (err as Error).message || err,
      });
    }
  } else {
    if (!baseURL) {
      logger.warn('No Kernel audit base URL configured (KERNEL_AUDIT_URL or KERNEL_AUDIT_API_URL)');
    }
    if (skipMtls) {
      logger.info('DEV_SKIP_MTLS enabled; not using mTLS for Kernel comms');
    }
  }

  const instance = axios.create({
    baseURL: baseURL || undefined,
    timeout: 5000,
    httpsAgent,
    validateStatus: (s) => s >= 200 && s < 300,
  });

  return instance;
}

const http = makeAxios();

/**
 * Post an audit event to Kernel's audit endpoint.
 * This is a thin wrapper; the caller should prepare the canonical payload.
 *
 * If kernel audit URL is not configured, this will log and resolve (no-op).
 */
export async function postAuditEvent(eventType: string, payload: any): Promise<void> {
  const url = (config.kernelAuditUrl || process.env.KERNEL_AUDIT_URL || '').replace(/\/$/, '') || '';
  if (!url) {
    logger.warn('postAuditEvent: Kernel audit URL not configured; skipping audit append', { eventType });
    return;
  }

  const endpoint = '/kernel/audit';
  try {
    await http.post(endpoint, { eventType, payload });
    logger.info('posted audit event to Kernel', { eventType });
  } catch (err) {
    logger.warn('failed to post audit event to Kernel', {
      eventType,
      error: (err as Error).message || err,
    });
    // Do not throw — caller may want to continue operating even if audit append fails.
  }
}

export default {
  postAuditEvent,
};

