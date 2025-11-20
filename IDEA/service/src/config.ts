import { config as loadEnv } from 'node:process';

export interface IdeaConfig {
  port: number;
  host: string;
  databaseUrl: string;
  s3Bucket: string;
  s3Endpoint?: string;
  s3Region: string;
  s3AccessKey?: string;
  s3Secret?: string;
  kernelApiUrl: string;
  signingProxyUrl?: string;
  requireKms: boolean;
  requireSigningProxy: boolean;
  requireMtls: boolean;
  auditActorPrefix: string;
  authJwtSecret?: string;
  demoToken?: string;
}

export function getConfig(): IdeaConfig {
  const port = Number(process.env.IDEA_PORT || process.env.PORT || 6060);
  const host = process.env.IDEA_HOST || process.env.HOST || '0.0.0.0';
  const databaseUrl =
    process.env.IDEA_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/idea';

  const s3Bucket = process.env.IDEA_S3_BUCKET || 'idea-packages';
  const s3Endpoint = process.env.IDEA_S3_ENDPOINT || process.env.S3_ENDPOINT;
  const s3Region = process.env.IDEA_S3_REGION || process.env.AWS_REGION || 'us-east-1';
  const s3AccessKey = process.env.IDEA_S3_ACCESS_KEY || process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
  const s3Secret = process.env.IDEA_S3_SECRET || process.env.S3_SECRET || process.env.AWS_SECRET_ACCESS_KEY;
  const kernelApiUrl = process.env.KERNEL_API_URL || 'http://127.0.0.1:7001';
  const signingProxyUrl = process.env.SIGNING_PROXY_URL;

  return {
    port,
    host,
    databaseUrl,
    s3Bucket,
    s3Endpoint,
    s3Region,
    s3AccessKey,
    s3Secret,
    kernelApiUrl,
    signingProxyUrl,
    requireKms: toBool(process.env.REQUIRE_KMS),
    requireSigningProxy: toBool(process.env.REQUIRE_SIGNING_PROXY),
    requireMtls: toBool(process.env.REQUIRE_MTLS),
    auditActorPrefix: process.env.IDEA_AUDIT_ACTOR_PREFIX || 'service:idea',
    authJwtSecret: process.env.AUTH_JWT_SECRET,
    demoToken: process.env.DEMO_BEARER_TOKEN
  };
}

function toBool(value?: string | null): boolean {
  if (!value) return false;
  return ['true', '1', 'yes', 'y'].includes(value.toLowerCase());
}
