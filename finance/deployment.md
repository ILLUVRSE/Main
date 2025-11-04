# Finance — Deployment & Infrastructure Guide

Purpose
-------
Operational, production-ready guidance for Finance & Billing: secure deployment patterns, ledger integrity, KMS/HSM signing, reconciliation, backups, and runbooks to satisfy auditors and compliance.

1) High-level architecture
--------------------------
- **Finance API** (stateless): handles invoices, payments, ledger posting, proofs, payouts and reconciliation.
- **Ledger store**: authoritative Postgres for journal entries (append-only semantics) and ledger indices.
- **Signing & Proofs**: KMS/HSM-backed signatures for journal entries and proof packages.
- **Payment integration**: webhook handlers for payment providers; idempotent processing layer.
- **Eventing & audit**: emit AuditEvents for ledger actions; events archived to S3.
- **Payout engine**: batch runner to create payout files and integrate with PSP or bank rails in a controlled manner.

2) Required infra & providers
-----------------------------
- Kubernetes for API + workers.
- Managed Postgres with WAL/PITR; preferably isolated cluster for Finance.
- S3 with versioning/object-lock for audit and proof archives.
- KMS/HSM for signing ledger entries and cryptographic proofs.
- Vault for secrets.
- Kafka/Redpanda for eventing and reconciliation pipelines.
- Monitoring + tracing stack.

3) Deployment patterns
----------------------
- Namespace: `finance-<env>`.
- Helm chart: Deployments for API, worker, payout runner; ConfigMaps; Secrets (vault); HPA; NetworkPolicy.
- Minimum replicas: 2+ replicas for API; payout runner scheduled jobs.
- Strong network isolation for Finance services.

4) Ledger & integrity guarantees
-------------------------------
- Ledger entries posted as append-only JournalEntry objects with `hash` and `signature`.
- Posting flow:
  1. Prepare canonical JournalEntry (canonical JSON).
  2. Compute SHA-256 hash.
  3. Request KMS signature for hash.
  4. Persist JournalEntry in Postgres *with* hash/signature and emit AuditEvent.
- Support reversing entries (corrections) as new entries that reference original.

5) Secrets, KMS & signing
-------------------------
- Use KMS/HSM for all signing operations (no local private keys).
- Signing proxy (mTLS) recommended to centralize access control.
- Document key rotation & emergency procedures for auditors.

6) Payment provider integration & idempotency
--------------------------------------------
- Webhook endpoints must be idempotent: dedupe by provider reference and idempotency keys.
- Reconciliation pipeline matches provider transactions to ledger and flags mismatches automatically.
- Retries and DLQ for transient provider errors.

7) Backups, DR & proof exports
------------------------------
- Postgres: PITR + daily snapshots; test restore.
- Journal archive: nightly signed export of ledger segments to S3 with head-hash; provide `POST /finance/verify` to generate signed proofs for auditors.
- Ability to replay ledger segments and rebuild indexes when necessary.

8) Security & compliance
------------------------
- Finance runs in a restricted network zone; minimal service egress.
- mTLS and RBAC for services; OIDC with 2FA for human UI.
- Use vault for all secrets; no secrets in code or images.
- PCI scope: do not store card data; use managed PSP (Stripe) and adhere to PCI controls for webhook endpoints.
- High-risk actions (large payouts, escrow releases) require multisig via Kernel — 3-of-5 enforcement.

9) Observability & SLOs
-----------------------
- Metrics: invoice creation latency, journal post latency, payout success/failure rates, reconciliation lag.
- Tracing: cover payment webhook → ledger post → audit chain → payout.
- Alerts: ledger imbalance, signing failures, reconciliation drift, payout failures.

10) CI/CD & release strategy
----------------------------
- CI: unit tests for accounting invariants, contract tests for provider integrations, SAST.
- Integration tests: end-to-end invoice → payment → ledger posting → payout → refund flows (staging with PSP sandbox).
- CD: deploy to staging, run acceptance suite, run reconciliation drills, then canary to production.

11) Testing & validation
------------------------
- Unit tests: balancing invariants (debit==credit), reversing entry logic.
- Integration tests: webhook idempotency, reconciliation, proof generation and verification.
- Load tests: throughput for expected invoice/payment volumes and payout batch sizes.

12) Runbooks (must exist)
-------------------------
- Payout failure & retry runbook (manual payout + rollback).
- Reconciliation mismatch investigation (how to locate and fix mismatches).
- Emergency revoke & clawback procedure (how to reverse payouts and produce audit trail).
- Key compromise (signing key) runbook: emergency rotation and notification steps.
- Restore drill: full restore of ledger from S3 + index rebuild and verification.

13) Acceptance criteria (deployment)
------------------------------------
- Finance deployed to staging with Postgres and KMS integrated; `POST /finance/verify` produces valid signed proofs.
- Double-entry ledger: balanced entries for all posted transactions in tests.
- Idempotent webhook handling validated (duplicate webhook does not double-post).
- Payout batching & multisig gating validated in staging.
- Reconciliation pipeline runs automatically and reports zero mismatches for a provided sample dataset.
- Backups & restore drills succeed; proof verification works end-to-end.
- Security: mTLS, Vault for secrets, and no private keys in cluster; PCI controls verified for payment flows.

End of file.

