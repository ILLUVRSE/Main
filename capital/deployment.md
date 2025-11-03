# Capital & Investments — Deployment & Infrastructure Guide

Purpose: production-ready operational guidance for deploying the Capital & Investments service. This doc covers recommended infrastructure, Kubernetes patterns, security & compliance (KYC/AML), approval/multisig flows, integration with Finance and Kernel, monitoring, backups, CI/CD, and runbooks. Capital handles high-trust flows — follow controls exactly.

---

# # 1) High-level architecture
- **Capital API & UI**: stateless backend + admin UI for analysts, approvers, and auditors.
- **Workflow engine**: orchestrates underwriting, allocation requests, approval workflows, and multisig coordination. Can be a durable workflow system (Temporal/Conductor) or a robust job/queue setup.
- **Persistent store**: dedicated Postgres for deals, underwriting records, allocations, approvals, and portfolio.
- **Document store**: S3 for deal documents, signed memos, and KYC evidence (store pointers, not raw PII). Use object lock/versioning for audit buckets.
- **Eventing & audit**: Kafka/Redpanda for events (deal events, approval events); Kernel audit bus integration to write immutable audit events.
- **Signing & multisig**: KMS/HSM + Kernel multisig workflow for approving high-value allocations. Signing proxy for HSM access.
- **KYC/AML providers**: external connectors (on-prem or SaaS) that return evidence refs and compliance results. Integrate via secure, auditable APIs.
- **Finance integration**: call Finance APIs to reserve/apply funds, escrow, and reconcile ledger entries.
- **SentinelNet**: synchronous compliance checks (sanctions/KYC) before allocations apply.

---

# # 2) Infrastructure & provider choices
- **Kubernetes** (managed EKS/GKE/AKS) for API + UI + workflow engine. Multi-AZ for resilience.
- **Postgres** (managed RDS/CloudSQL) for authoritative state. Use separate DB instance/cluster for Capital.
- **S3** (or compatible) for document storage with versioning and object lock. Encrypt at rest.
- **Kafka/Redpanda** for eventing and audit integration.
- **KMS/HSM** for signing and proof generation. Use cloud HSM or managed HSM-backed KMS.
- **Vault** for secrets; tie DB creds and provider keys to Vault.
- **CI/CD**: GitHub Actions / GitLab CI + ArgoCD/Flux for GitOps.

---

# # 3) Kubernetes deployment patterns
- **Namespaces:** `capital-api`, `capital-workers`, `capital-admin`.
- **Helm chart**: package Deployments, Services, Ingress, ConfigMaps, Secrets (injected from Vault), HPA, NetworkPolicy, and PodDisruptionBudget.
- **Leader election**: implement leases for workflow orchestration and single-writer tasks (allocation reconciler).
- **Pod security**: enforce non-root, drop capabilities, and restrict hostPath; use Pod Security admission or OPA Gatekeeper.

---

# # 4) Workflow & orchestration
- **Durable workflows:** use Temporal or similar to coordinate multi-step flows: underwriting → allocation request → SentinelNet check → multisig approvals → Finance reserve → apply. Durable workflows simplify retries and state.
- **Idempotency:** every external callback (KYC result, multisig approval, Finance confirmation) must be idempotent and correlated by stable request IDs.
- **Audit emissions:** each workflow step emits Kernel audit events (approval submissions, multisig signatures, allocation applied) and stores pointers to documents and evidence.

---

# # 5) KYC / AML / Compliance integration
- **Provider integration:** call third-party KYC/AML services via secure, auditable connectors. Store only evidence references and a compliance result (`pass|review|fail`) in DB. PII raw data is not stored in Capital DB.
- **Synchronous checks:** SentinelNet or Capital must perform synchronous sanctions/KYC checks for allocation approval paths. If check fails, block allocation and emit `policyCheck` with rationale.
- **Record keeping:** retain compliance evidence pointers and timestamps per legal retention requirements. Support legal holds.

---

# # 6) Multisig & approval flows
- **Quorum rules:** implement configurable thresholds (e.g., low/medium/high) and corresponding approver pools. Use Kernel multisig workflow for high-value approvals.
- **Approval artifacts:** all approvals are signed artifacts (approverId, signerId, signature, ts) and stored as part of the audit trail.
- **Emergency path:** allow emergency approvals by SuperAdmin/SecurityEngineer (break-glass) with retroactive multisig ratification — follow multisig-workflow. Log and audit all emergency actions.

---

# # 7) Finance & escrow interactions
- **Transactional apply:** allocation apply must be transactional: reserve funds in Finance → confirm reserve → post ledger entries → mark allocation applied. If any step fails, rollback reserve and emit audit event.
- **Escrow management:** for conditional investments, create escrow via Finance and tie escrow condition to audit evidence (delivery, milestones). Release escrow only after conditions validated and approvals satisfied.
- **Reconciliation:** daily or real-time reconciliation jobs to confirm allocations match Finance ledger.

---

# # 8) Security & governance
- **mTLS & RBAC:** all service-to-service calls use mTLS; human UI uses OIDC/SSO with 2FA. Enforce least privilege.
- **KMS/HSM:** signing operations (approval artifacts, allocation proofs) run via signing proxy to KMS/HSM. Keys are rotated per policy.
- **Data classification:** PII and sensitive documents stored only in encrypted S3 with access controls; evidence pointers used in DB. Apply legal data retention rules.
- **SentinelNet hooks:** run policy checks pre-allocation and for suspicious patterns (e.g., sudden large allocation requests).

---

# # 9) Observability & SLOs
- **Metrics:** deals/sec, underwriting latency, allocations/sec, approval latency, multisig wait time, Finance reconciliation lag, KYC turnaround time.
- **Tracing:** workflow traces across Kernel → Capital → KYC → Kernel → Finance. Include request IDs and approval IDs in traces.
- **Alerts:** approval backlogs, reconciliation failures, KYC provider errors, Audit bus lag.
- **SLO examples:** underwriting response p95 < X minutes (depends on process); allocation apply p95 < Y seconds (after approvals and Finance confirmation).

---

# # 10) Backups, DR & archival
- **Postgres backups & PITR:** daily snapshots + WAL archiving, cross-region snapshots if required. Test restores.
- **S3 archiving:** signed documents and evidence snapshots archived with object lock.
- **Audit replay:** ability to rebuild Capital state by replaying Kernel audit events if required. Document replay steps and verification.

---

# # 11) CI/CD & testing
- **Pipeline:** unit tests (business rules), contract tests (Kernel/Finance), integration tests with mocked KYC and Finance, security scans, deploy to staging, acceptance tests, then canary to prod.
- **Policy tests:** SentinelNet integration tests and multisig workflow tests required in CI for changes to approval logic.
- **Test data & replay:** use anonymized or synthetic data for staging; avoid production-sensitive PII in tests.

---

# # 12) Runbooks (must exist)
- Approval backlog remediation & operator escalation.
- Reconciliation mismatch investigation.
- KYC provider outage: fallback and manual review runbook.
- Multisig failure & recovery runbook.
- Restore & replay from audit events.
- Emergency allocation rollback and legal escalation.

---

# # 13) Acceptance criteria (deployment)
- **End-to-end allocation flow:** request → SentinelNet KYC/sanctions pass → approvals collected per threshold → Finance reserve → apply allocation → audit events emitted.
- **Multisig enforcement:** high-value allocations require multisig and fail without quorum.
- **KYC integration:** simulate KYC failure and show allocation blocked; simulate pass and proceed.
- **Reconciliation:** daily reconciliation identifies no mismatches for sample dataset.
- **Security & retention:** KMS/HSM signing used; document pointers for KYC evidence stored in S3 with object lock enabled.
- **Observability:** metrics and traces for all key flows; alerts configured and verified.

---

# # 14) Operational notes & cost controls
- **Isolate Capital:** run in a restricted environment with strict audit and change control.
- **Human-in-loop:** whole approval and multisig UX must be clear, auditable, and provide switching to manual review when automation fails.
- **Cost awareness:** track and cap third-party KYC costs and storage egress for large document sets.
- **Legal engagement:** coordinate with Legal for document retention policies and KYC evidence requirements.

---

End of file.

