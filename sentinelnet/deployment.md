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

---

## Network & security
- **Kernel ↔ SentinelNet**  
  - Must use **mutual TLS**. Kernel is a trusted client (system) with client certs in a signer registry.  
  - Restrict by network ACLs and authorize by cert identity mapping to a principal.  
- **Policy edits & admin UI**  
  - Policy edits only allowed by RBAC-enabled UIs or API clients. Use OIDC for human users; require 2FA and Admin/Multi-Reviewer flows for high-severity changes.
- **Policy activation gate**  
  - For `severity=HIGH|CRITICAL` transitions to `active` require multi-sig approvals via Kernel's multisig flow. SentinelNet should create a `policy_activation` upgrade manifest and require Kernel’s 3-of-5 flow to apply.
- **KMS/HSM**  
  - For any signing SentinelNet performs, use KMS/HSM with a named key per signer. Enforce key policies and audit key usage.
- **Dev vs prod configuration**  
  - Local dev may set `DEV_SKIP_MTLS=true` and run the mock Kernel via `npm run kernel:mock`. Production must set `DEV_SKIP_MTLS=false` and provide client cert/key paths (`KERNEL_MTLS_CERT_PATH`, `KERNEL_MTLS_KEY_PATH`, optionally `KERNEL_MTLS_CA_PATH`).  
  - `SENTINEL_ENABLE_AUDIT_CONSUMER` should be enabled in prod (polls Kernel audit events) and disabled in dev unless the mock Kernel is running.  
  - `run-local.sh` automates Postgres bootstrap, migrations, Kernel mock startup, and the verification suite; run it before submitting PRs.

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
    - If FP rate exceeds threshold for 3 consecutive windows, auto-roll back or pause canary.
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
1. **Policy activation (HIGH/CRITICAL)**:
   - Create policy (draft) → simulate → start canary (low percent) → collect metrics for X hours → open multisig upgrade manifest via Kernel → gather 3-of-5 approvals → Kernel applies upgrade → SentinelNet marks policy `active`. Record canary metrics and continue monitoring.
2. **Incident: high FP in canary**:
   - Pause canary (set percent=0), investigate, run simulation with latest data, and either fix rule or rollback to draft. If deployed, create rollback manifest and use multisig if required.
3. **Audit verification breach**:
   - Stop signing operations, run chain verifier, replay S3 archive to rebuild index, notify Security, and escalate to SuperAdmin (Ryan).
4. **Key rotation**:
   - Add new key to Key Registry, begin signing with new key, keep old key public available for verification for overlap window, rotate out old key after verification.

- **RBAC enforcement**:
  - In production SentinelNet should only be reachable through CommandPad or the Kernel API gateway. Those layers attach authenticated principals so SentinelNet can record `createdBy` / `editedBy` on policy mutations. Local dev defaults to `principal.id=unknown`; do not ship that configuration to prod.

---

## Deployment checklist
- [ ] Kubernetes manifests (Deployment, Service, HPA, PodDisruptionBudget)
- [ ] Ingress + mTLS configuration matching Kernel certs
- [ ] Managed Postgres (HA) and migration automation
- [ ] Kafka/Redpanda topic `audit-events` and consumer group config
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
