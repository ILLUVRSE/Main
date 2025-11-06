# Kernel — Production Deployment & Runbook

## Purpose

This document describes production deployment patterns, operational
runbooks, and the minimal requirements to operate Kernel in production.
Follow these notes precisely; production differs from local dev.

## High-level architecture

- API layer (stateless) behind a load balancer.  
- Policy/Enforcement: SentinelNet cluster enforcing policies synchronously
  for critical paths.  
- Persistent store: managed Postgres with WAL backups and PITR.  
- Reasoning/Vector store: scalable vector database with replicas.  
- Async workers: for audit processing, replay, and remediation.  
- Observability: Prometheus, Grafana, distributed tracing, structured logs.

## Infrastructure and provider choices

- Prefer managed services for Postgres, object storage, and KMS/HSM.  
- Kubernetes is the reference platform for stateless services; use
  auto-scaling groups for worker pools.  
- Use private networking and mTLS between internal services.

## Deployment patterns

- Blue/green or canary rollouts for API and SentinelNet.  
- Immutable container images built in CI. Images are signed in CI and
  must verify signature on deploy.  
- Use feature flags for rollout control and metrics gating.

## Synchronous check design

- Synchronous checks must return within the configured SLO (e.g., 200ms
  p95). For high-latency checks, return a fallback decision and emit a
  `policyCheck` with `simMode=true` if configured.  
- Fail-open is allowed only for simulated policies; otherwise fail-closed.

## Asynchronous and streaming evaluation

- Workers consume audit events and run retrospective policy checks.  
- Streaming consumers must checkpoint offsets and support replay.  
- Scale consumers independently; use backpressure and batching.

## Policy Registry and rollout

- Policies versioned and stored in Policy Registry. Each policy has a
  lifecycle: draft → test → canary → active → deprecated.  
- Canary: a small percentage of traffic or simulated runs compare
  current behavior vs. expected impact. Rollout only if metrics pass.

## Remediation and enforcement

- Remediations must be idempotent and must log `remediation` events.  
- High-risk remediation requires multi-sig approval or human-in-loop.  
- Remediation runbooks must exist and be automated where safe.

## Explainability and evidence

- Every `policyCheck` must include `rationale` and `evidence` pointers.  
- Expose an explain endpoint:

GET /sentinel/explain/{policyCheckId}

Return structured evidence and rule evaluation path.

## CI/CD and testing

- CI produces signed artifacts and container images.  
- Release pipeline runs integration tests, security scans, and
  performance smoke tests.  
- Production deployments require green checks and signed approval.

## Scaling and performance

- Autoscale API pods based on request latency and queue lengths.  
- For reasoning graph, partitioning/sharding is required for scale.  
- Benchmarks: target 99th-percentile latencies, capacity planning in
  runbooks.

## Security and signing

- All internal traffic must use mTLS and RBAC.  
- Production signing uses KMS/HSM. Do not use local keys in prod.  
- Keys: rotate on schedule and record rotation events in audit logs.

## Backups, disaster recovery, and replay

- Postgres PITR and daily snapshots.  
- Object store replication across regions.  
- Replay tooling for audit events with deterministic ordering.

## Runbooks and playbooks

- Health check failure:  
  1. Check pods and node statuses.  
  2. Check DB connectivity and WAL lag.  
  3. Roll back if needed or scale pods.

- Audit integrity alert: verify `audit_events` tail and run replay test. Use `node tools/audit-verify.js --database-url $POSTGRES_URL --signers /path/to/signers.json` to confirm the chain head hash. The signers file must map each `signerId` to a base64 Ed25519 public key (`{"signers":[{"signerId":"kernel-signer","publicKey":"<base64>"}]}`).
- Key compromise: rotate keys, revoke old keys, and replay signed
  manifests for verification.

## Acceptance criteria for production deployment (minimal)

- Signed container images and signed deployment artifacts.  
- KMS-backed production signing enabled and tested.  
- DR plan in place and tested (restore within RTO, RPO met).  
- Observability: metrics, traces, and alerting on SLOs.  
- Canary/rollout gating with automated rollback.

## Operational notes and cost controls

- Limit high-cardinality metrics; use sampling for traces.  
- Use spot/scale-down for non-critical worker types.  
- Tagging and cost center allocation required for all resources.

## Final notes

- Do not store production secrets in source control. Use environment
  injection and secrets managers.  
- Update this runbook with every operational change and sign-off by
  Security and Ops owners.
