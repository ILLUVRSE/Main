// sentinelnet/src/config/env.ts
import assert from 'assert';

export type NodeEnv = 'development' | 'test' | 'production';

export interface Config {
  nodeEnv: NodeEnv;
  port: number;
  dbUrl: string;
  devSkipMtls: boolean;
  kernelAuditUrl?: string;
  metricsEnabled: boolean;
  sentinelHost?: string;
}

function parseBool(v: string | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

/**
 * Load configuration from environment variables.
 * In production we require certain settings (DB and audit endpoint).
 */
export function loadConfig(): Config {
  const nodeEnv = (process.env.NODE_ENV as NodeEnv) || 'development';
  const port = Number(process.env.SENTINEL_PORT || process.env.PORT || '7602');
  const dbUrl = process.env.SENTINEL_DB_URL || process.env.DATABASE_URL || '';
  const devSkipMtls = parseBool(process.env.DEV_SKIP_MTLS, true);
  const kernelAuditUrl = process.env.KERNEL_AUDIT_URL || process.env.KERNEL_AUDIT_API_URL;
  const metricsEnabled = parseBool(process.env.METRICS_ENABLED, true);
  const sentinelHost = process.env.SENTINEL_HOST || undefined;

  // Basic validations
  if (nodeEnv === 'production') {
    assert(dbUrl, 'SENTINEL_DB_URL is required in production');
    // Kernel audit url ideally required in prod if SentinelNet calls kernel directly.
    // If your deployment relies on Kernel to sign events, you may skip this.
    if (!kernelAuditUrl) {
      console.warn('KERNEL_AUDIT_URL not set — ensure audit events are being recorded via Kernel');
    }
  }

  return {
    nodeEnv,
    port,
    dbUrl,
    devSkipMtls,
    kernelAuditUrl,
    metricsEnabled,
    sentinelHost,
  };
}

