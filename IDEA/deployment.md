# IDEA — Deployment & Infra

This document describes how to deploy IDEA (codex-server) in dev/staging/prod, required infrastructure, env variables, and operational checks.

## Runtime components
- Node.js Express server (TypeScript, `codex-server`).
- Optional frontend Vite server (codex-web) for dev; production served from CDN or a static host.
- Storage: S3-compatible (MinIO/Cloud S3) for artifact uploads.
- Secrets: Vault for runtime secrets (Kernel JWT, KMS credentials).
- Optional: Redis for idempotency store (or Postgres).

## Required env vars
- `HOST` (default 127.0.0.1)
- `PORT` (default 5175)
- `ALLOWED_ORIGIN` (frontend origin)
- `STORAGE_ENDPOINT` (S3/MinIO)
- `STORAGE_BUCKET` (artifact bucket)
- `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` (or IAM)
- `KERNEL_URL` (http(s) endpoint)
- `KERNEL_MTLS_CERT` / `KERNEL_MTLS_KEY` (if using mTLS)
- `KERNEL_JWT` (if using JWT)
- `VAULT_ADDR` and cert-based auth configs
- `KMS_SIGNING_ENDPOINT` (optional)
- `OIDC_JWKS_URL` (for JWT verification)

## Docker / Kubernetes
Provide a container image that contains `dist/index.js` (build via `npm run build`). Example Kubernetes resources:

- Deployment: 2+ replicas, readiness/liveness probes:
  - `/health` (200)
  - `/ready` check that S3 and Kernel connectivity OK.
- HorizontalPodAutoscaler configured on `cpu` or custom metric `kernel.submit.latency`.
- Secret mount for `KERNEL_MTLS_{CERT,KEY}` or use Kubernetes TLS Secrets.
- ConfigMap for config values that are not secrets.

## Storage & networking
- S3 bucket with versioning and server-side encryption (SSE-KMS).
- Bucket policy allowing presigned uploads only via IDEA backend (server signs presigned URLs).
- TLS termination at edge (ingress) with mTLS enabled between IDEA and Kernel if required.

## Observability & logging
- Structured JSON logs with `request_id`, `actor_id`, `endpoint`, `duration_ms`.
- Metrics endpoint (Prometheus exposition) for:
  - `kernel_submit_latency_seconds`
  - `kernel_validation_pass_total`
  - `sandbox_run_duration_seconds`
- Tracing: integrate with OpenTelemetry and include trace IDs in logs.

## Security & lifecycle
- Use Vault for `KERNEL_JWT`, `STORAGE_*` secrets and rotate per policy.
- Do not log JWTs, private keys, or raw callback bodies in prod.
- CI must run unit tests and contract tests prior to releasing images. A signing/approval step must gate `release` to production (SuperAdmin approval recorded).

## Backups & recovery
- Persist server-generated metadata to Postgres or other durable DB. Configure point-in-time recovery for DB.
- Provide a replay tool to reprocess any queued Kernel submit operations if system fails mid-flight.

## Deployment checklist (post-deploy verification)
- `/health` returns OK, `/ready` indicates S3 + Kernel connectivity.
- Smoke test: package → upload → complete → submit (mock kernel) passes.
- Callback verification test runs and stores a signed manifest correctly.

