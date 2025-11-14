# SentinelNet — Deployment & Operations (draft)

This document describes a practical, production-minded deployment plan for SentinelNet:
high-availability topology, mTLS requirements, KMS/keys, SLOs, canary strategy, and operational concerns.

> Final approver: **Ryan (SuperAdmin)**. Security Engineer must review KMS/HSM and mTLS config.

---

## Goals
- Low-latency synchronous checks for Kernel pre-action enforcement (p95 SLO target).
- Strong cryptographic and access controls (mTLS + RBAC) for Kernel ↔ SentinelNet and for policy edits.
- Auditable decisions: every enforcement emits a signed `policy.decision` audit event.
- Safe policy lifecycle: simulation, canary rollouts, and multisig gating for high-severity activations.
- Scalable async detection (audit stream consumer) for post-hoc policy checks.

---

## Topology (recommended)
1. **Service cluster (K8s)**  
   - Deploy SentinelNet as a deployment with **N** replicas (N >= 3) behind a fronting service (NLB / Ingress).  
   - Use Pod anti-affinity so replicas spread across AZs.
2. **API / control plane**  
   - Expose HTTPS ingress for admin/operator UIs (commandpad) and Kernel. Use mTLS for Kernel communication; OIDC/SAML for human UIs.  
   - Internal service mesh (optional) to enforce mTLS and observability.
3. **State & storage**  
   - Postgres (managed) for policy registry and policy history (single writer via leader/failover).  
   - Kafka / Redpanda for audit-events stream (single-writer-per-partition semantics).  
   - S3 (immutable) for archival snapshots (policy and decision exports).
4. **KMS / signing**  
   - Use cloud KMS (AWS KMS / GCP KMS / HSM) or a signing service for any signing needs. Prefer Kernel to sign audit events centrally. If SentinelNet must sign, store keys in KMS/HSM only. Rotate keys with overlap windows.

## Configuration & environment

| Variable | Notes |
| --- | --- |
| `SENTINEL_PORT` | HTTP listen port (default `7602`). Behind ingress; keep readiness/liveness endpoints open internally. |
| `SENTINEL_DB_URL` | Postgres connection string with `sslmode=verify-full`. Used by migrations + runtime. |
| `DEV_SKIP_MTLS` | `false` in prod to enforce mutual TLS with Kernel; set `true` only in local dev. |
| `KERNEL_MTLS_CERT_PATH` / `KERNEL_MTLS_KEY_PATH` / `KERNEL_MTLS_CA_PATH` | PEM paths for client cert auth. Mount from Vault/Secrets Manager via CSI and rotate quarterly. |
| `KERNEL_AUDIT_URL` | Kernel audit endpoint used by HTTP poller + simulation flows. |
| `SENTINEL_ENABLE_AUDIT_CONSUMER` | Enables async consumer. Requires Kafka vars to be set or HTTP poller fallback. |
| `SENTINEL_KAFKA_BROKERS`, `SENTINEL_AUDIT_TOPIC`, `SENTINEL_KAFKA_CONSUMER_GROUP` | Kafka/Redpanda settings for streaming audit ingest. |
| `SENTINEL_RBAC_ENABLED`, `SENTINEL_RBAC_HEADER`, `SENTINEL_RBAC_CHECK_ROLES`, `SENTINEL_RBAC_POLICY_ROLES` | Enforce role headers for check vs policy mutations. Use Gateway to inject roles (see `infra/rbac-config.md`). |
| `SENTINEL_CANARY_AUTO_ROLLBACK`, `SENTINEL_CANARY_ROLLBACK_THRESHOLD`, `SENTINEL_CANARY_ROLLBACK_WINDOW` | Tune deterministic rollback automation. |
| `SENTINEL_CANARY_METRIC_WINDOW_SEC` | Optional override for metrics sampling window. |
| `SENTINEL_KMS_KEY_ID` or `SENTINEL_SIGNING_ENDPOINT` | Choose between cloud KMS key vs signer proxy for audit/policy signatures. |
| `SENTINEL_POLICY_EXPORT_BUCKET`, `SENTINEL_POLICY_EXPORT_PREFIX` | S3 bucket/prefix for immutable policy snapshots (enable object-lock + versioning). |

Secrets pattern:
- Store DB URL, Kafka creds, KMS tokens, and mTLS materials in Vault or Secrets Manager, injected via CSI driver or sealed secrets.
- Use IAM roles for service accounts (IRSA) in K8s clusters to grant `kms:Sign`/`DescribeKey` and the minimum S3/Kafka permissions.
- Keep debug features disabled in prod: omit `AI_INFRA_ALLOW_DEBUG_TOKEN` equivalents and never set `DEV_SKIP_MTLS=true`.

### Database & migrations

`sentinelnet/sql/migrations/001_create_policies.sql` creates `policies` + `policy_history` tables and triggers. Run migrations via npm script or DB toolchain before each deploy:

```bash
cd sentinelnet
npm run migrate # uses SENTINEL_DB_URL
```

In Kubernetes, package migrations as a Job/Helm hook running `npm run migrate` or `psql -f ...` with the same image. Enforce that application pods start only after the migrate job succeeds to avoid serving against an outdated schema.

---

## Network & security
- **Kernel ↔ SentinelNet**  
  - Must use **mutual TLS**. Kernel is a trusted client (system) with client certs in a signer registry.  
  - Restrict by network ACLs and authorize by cert identity mapping to a principal.  
- **Policy edits & admin UI**  
  - Policy edits only allowed by RBAC-enabled UIs or API clients. Use OIDC for humans; require 2FA and multi-reviewer approvals for `HIGH/CRITICAL`. SentinelNet now ships RBAC middleware (`SENTINEL_RBAC_ENABLED=true`) which enforces role headers (`SENTINEL_RBAC_HEADER`, default `X-Sentinel-Roles`). Configure `SENTINEL_RBAC_CHECK_ROLES` (e.g., `kernel-service`) and `SENTINEL_RBAC_POLICY_ROLES` (e.g., `kernel-admin,kernel-superadmin`) so the API rejects callers lacking proper roles.
  - Production builds refuse to start if RBAC is disabled or these role lists are empty; configure canonical values per `infra/rbac-config.md` and ensure the API gateway injects the header for human/admin flows.
- **Policy activation gate**  
  - For `severity=HIGH|CRITICAL` transitions to `active` require multi-sig approvals via Kernel's multisig flow. SentinelNet should create a `policy_activation` upgrade manifest and require Kernel’s 3-of-5 flow to apply.
- **KMS/HSM**  
  - For any signing SentinelNet performs, use KMS/HSM with a named key per signer. Enforce key policies and audit key usage.
- **Dev vs prod configuration**  
  - Local dev may set `DEV_SKIP_MTLS=true` and run the mock Kernel via `npm run kernel:mock`. Production must set `DEV_SKIP_MTLS=false` and provide client cert/key paths (`KERNEL_MTLS_CERT_PATH`, `KERNEL_MTLS_KEY_PATH`, optionally `KERNEL_MTLS_CA_PATH`). The service now enforces this at startup (`NODE_ENV=production` fails fast if `DEV_SKIP_MTLS=true`).  
  - `SENTINEL_ENABLE_AUDIT_CONSUMER` should be enabled in prod (polls Kernel audit events) and disabled in dev unless the mock Kernel is running.  
  - `run-local.sh` automates Postgres bootstrap, migrations, Kernel mock startup, and the verification suite; run it before submitting PRs.
- **Audit ingress (Kafka vs HTTP)**  
  - Preferred: set `SENTINEL_KAFKA_BROKERS`, `SENTINEL_AUDIT_TOPIC`, `SENTINEL_KAFKA_CONSUMER_GROUP`, and `SENTINEL_ENABLE_AUDIT_CONSUMER=true` to stream events via Kafka/Redpanda (see `src/event/kafkaConsumer.ts`).  
  - Fallback: unset Kafka vars to continue using the HTTP poller (`src/event/consumer.ts`) against `/kernel/audit/search`.

---

## SLOs & Performance
- **Primary SLOs (synchronous checks)**:
  - `p50` target: 5 ms
  - `p95` target: 50 ms (adjust based on infra)
  - `p99` target: 200–300 ms (depends on policy complexity)
  - Error budget: 1% monthly
- **Operational metrics**:
  - check latency p50/p95/p99
  - decisions per second (by decision)
  - policy.eval failures and evaluator errors
  - audit append success/failure rate
  - canary false-positive rate (simulation)
- **Capacity**:
  - Size replicas based on expected check TPS. Use connection pools for DB and keep evaluator CPU-bound work fast; JSONLogic is cheap, complex evaluation may need CPU scaling.
- **Local verification**:
  - `npm test -- checkLatency.test.ts` executes ~100 synchronous checks against the service and prints p95 latency; the dev gate is `< 200ms`.  
  - `/metrics` exposes `sentinel_check_latency_seconds`, so production dashboards can alert if `p95 > 50ms` for more than 5 minutes (primary SLO breach).

---

## Policy lifecycle & canary strategy
- **States**: `draft` → `simulating` → `canary` → `active` (or `deprecated`).
- **Simulation**:
  - Run simulations on historical audit samples. Produce impact report with match rate and concrete examples.
  - Simulation must measure false-positive estimates (where labels exist) and produce a recommended canary percent.
- **Canary rollout**:
  - Use deterministic sampling keyed on `requestId` or event id. Default canaryPercent 5–10%.
  - Monitor canary metrics (match rate, remediation success, false positives). Rolling window (5–15 minutes) and thresholds:
    - SentinelNet’s `canaryRollback` automation watches enforced denials while in canary state; configure `SENTINEL_CANARY_AUTO_ROLLBACK`, `SENTINEL_CANARY_ROLLBACK_THRESHOLD`, `SENTINEL_CANARY_ROLLBACK_WINDOW`, and cooldown to automatically revert a canary back to `draft` when FP rate spikes.
  - Canary → Active transition:
    - For `LOW/MEDIUM`: automatic after stability period (e.g., 1–24h) if metrics are good.
    - For `HIGH/CRITICAL`: require Kernel multisig `3-of-5` approval. SentinelNet should create a `policy_activation` manifest and Kernel applies multisig gating.
- **Rollback**:
  - Define rollback plan in the manifest and ensure audit events record rollback rationale.

---

## Audit & Explainability
- **Audit events**:
  - Every decision must emit `policy.decision` (canonical payload matching Kernel audit spec) with `policyId`, `policyVersion`, `evidenceRefs`, `rationale`, and `ts`. Prefer Kernel to sign and publish the event; if SentinelNet signs, it must do so with KMS-managed keys and publish signed events to Kernel.
- **Explainability**:
  - `GET /sentinelnet/policy/{id}/explain` must return rule text, recent decisions (with audit references), and a change history.
  - Keep evidence pointers short (audit id or metric snapshot id) for forensic linking.
- **Retention**:
  - Keep `policy_history` and policy metadata in Postgres indefinitely; keep audit data per Kernel's retention policies and S3 cold storage for long-term retention.

---

## Availability & High-availability patterns
- Use multiple replicas behind an ingress/NLB. Configure readiness/liveness probes.
- Policy store (Postgres) should be managed with automated failover and backups.
- Event consumer should be partition-aware and support rebalance/consumer groups in Kafka. Prefer a stateful consumer separate from primary service if heavy processing is required.

---

## Key operational runbooks (brief)
1. **Policy activation (HIGH/CRITICAL)**  
   1. Draft policy; require simulation report signed by owner.  
   2. Launch canary with `metadata.canaryPercent <= 0.1`, monitor `/metrics` (`sentinel_canary_percent`, FP gauges) + Kafka DLQ.  
   3. Generate upgrade manifest via `multisigGating.createPolicyActivationUpgrade`, capture rollback plan + impact metrics.  
   4. Collect ≥3 approvals, then call `applyUpgrade`; wait for Kernel to mark `applied`.  
   5. Flip policy state to `active`, bump version, archive policy snapshot to S3 (object-lock), notify stakeholders.  
   6. Track metrics for 24h; if spikes occur, execute rollback manifest (set `state=deprecated`, re-open canary in draft).  
2. **Incident: high FP in canary**  
   1. Auto-rollback should trip when threshold exceeded; if not, manually set `canaryPercent=0`.  
   2. Tag incident, collect false-positive samples from audit stream, reproduce locally.  
   3. Compare simulation dataset vs live; update rule or metadata, re-run simulation before re-opening canary.  
   4. Document resolution and attach to policy history.  
3. **Audit verification breach**  
   1. If signature mismatch detected, halt signing by revoking IAM permissions or toggling `SENTINEL_KMS_KEY_ID` to a disabled key.  
   2. Run chain verifier against S3 exports; locate divergence block height.  
   3. Rebuild audit index from Kernel events, recompute signatures via trusted signer, and republish.  
   4. File incident report referencing affected policy IDs and notify compliance.  
4. **Key rotation / compromise**  
   1. Introduce new key in KMS, update `SENTINEL_KMS_KEY_ID` (or proxy token) on a single canary pod, ensure signatures validate.  
   2. Roll across fleet; keep old public key published for verification for at least retention window.  
   3. After overlap, disable old key, purge secrets, and update Runbook with new signer ID.  

- **RBAC enforcement**:
  - In production SentinelNet should only be reachable through CommandPad or the Kernel API gateway. Those layers attach authenticated principals so SentinelNet can record `createdBy` / `editedBy` on policy mutations. Local dev defaults to `principal.id=unknown`; do not ship that configuration to prod.

---

## Deployment checklist
- [ ] Kubernetes manifests (Deployment, Service, HPA, PodDisruptionBudget)
- [ ] Ingress + mTLS configuration matching Kernel certs
- [ ] Managed Postgres (HA) and migration automation
- [ ] Kafka/Redpanda topic `audit-events` and consumer group config
- [ ] Container image built from Dockerfile + reference K8s manifest (`deploy/k8s/sentinelnet-deployment.yaml`) updated with env + secrets
- [ ] KMS/HSM keys provisioned and accessible to SentinelNet (or Kernel signs)
- [ ] Monitoring & alerting (latency SLO, error rates, audit append failures)
- [ ] Canary automation & runbooks implemented
- [ ] Multisig gating tested end-to-end with Kernel

---

## Notes & tradeoffs
- For simplicity and strong governance, prefer **Kernel** to be the authoritative signer and append audit events; SentinelNet should request Kernel to append audit events and only keep local references. This reduces key management surface in SentinelNet.
- JSONLogic is good for rapid iteration; for production-level expressivity consider CEL or a policy DSL with stronger typing and explainability.

---

## Next steps
- Finalize SLO numeric targets with product and infra.
- Deliver K8s manifests and Helm chart for SentinelNet.
- Implement canary automation and CI tests for multisig gating.
- Security Engineer to review KMS/mTLS choices and sign-off.
