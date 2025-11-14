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
  rbacEnabled: boolean;
  rbacHeader: string;
  rbacCheckRoles: string[];
  rbacPolicyRoles: string[];
  kafkaBrokers?: string[];
  kafkaAuditTopic?: string;
  kafkaClientId?: string;
  kafkaGroupId?: string;
  kafkaFromBeginning: boolean;
  canaryAutoRollbackEnabled: boolean;
  canaryRollbackWindow: number;
  canaryRollbackThreshold: number;
  canaryRollbackCooldownMs: number;
}

function parseBool(v: string | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function parseCsv(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
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
  const rbacEnabled = parseBool(process.env.SENTINEL_RBAC_ENABLED, nodeEnv === 'production');
  const rbacHeader = (process.env.SENTINEL_RBAC_HEADER || 'x-sentinel-roles').toLowerCase();
  const rbacCheckRoles = parseCsv(process.env.SENTINEL_RBAC_CHECK_ROLES || 'kernel-service,kernel-admin');
  const rbacPolicyRoles = parseCsv(process.env.SENTINEL_RBAC_POLICY_ROLES || 'kernel-admin,kernel-superadmin');
  const kafkaBrokers = parseCsv(process.env.SENTINEL_KAFKA_BROKERS);
  const kafkaAuditTopic = process.env.SENTINEL_AUDIT_TOPIC || process.env.SENTINEL_KAFKA_AUDIT_TOPIC;
  const kafkaClientId = process.env.SENTINEL_KAFKA_CLIENT_ID || 'sentinelnet';
  const kafkaGroupId = process.env.SENTINEL_KAFKA_CONSUMER_GROUP || 'sentinelnet-audit-consumer';
  const kafkaFromBeginning = parseBool(process.env.SENTINEL_KAFKA_FROM_BEGINNING, false);
  const canaryAutoRollbackEnabled = parseBool(process.env.SENTINEL_CANARY_AUTO_ROLLBACK, true);
  const canaryRollbackWindow = Number(process.env.SENTINEL_CANARY_ROLLBACK_WINDOW || 50);
  const canaryRollbackThreshold = Number(process.env.SENTINEL_CANARY_ROLLBACK_THRESHOLD || 0.3);
  const canaryRollbackCooldownMs = Number(process.env.SENTINEL_CANARY_ROLLBACK_COOLDOWN_MS || 10 * 60 * 1000);

  // Basic validations
  if (nodeEnv === 'production') {
    assert(dbUrl, 'SENTINEL_DB_URL is required in production');
    assert(!devSkipMtls, 'DEV_SKIP_MTLS must be false in production (mTLS is mandatory)');
    assert(rbacEnabled, 'SENTINEL_RBAC_ENABLED must be true in production (RBAC required)');
    assert(
      rbacCheckRoles.length > 0,
      'SENTINEL_RBAC_CHECK_ROLES cannot be empty in production (define allowed service roles)',
    );
    assert(
      rbacPolicyRoles.length > 0,
      'SENTINEL_RBAC_POLICY_ROLES cannot be empty in production (define allowed admin roles)',
    );
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
    rbacEnabled,
    rbacHeader,
    rbacCheckRoles,
    rbacPolicyRoles,
    kafkaBrokers: kafkaBrokers.length ? kafkaBrokers : undefined,
    kafkaAuditTopic,
    kafkaClientId,
    kafkaGroupId,
    kafkaFromBeginning,
    canaryAutoRollbackEnabled,
    canaryRollbackWindow,
    canaryRollbackThreshold,
    canaryRollbackCooldownMs,
  };
}
