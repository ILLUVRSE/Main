# AI & Infrastructure — Acceptance Criteria

Purpose: short, verifiable checks proving the AI & Infrastructure stack is correct, reproducible, secure, auditable, and production-ready. Each item is actionable and testable.

---

# # 1) Reproducible training runs
- **Requirement:** Training jobs record full provenance (codeRef, container image digest, dependency manifest, dataset checksums, hyperparams, seed, environment) and rerunning a small deterministic job with identical inputs produces identical artifact checksum (or documented acceptable variance).
- **How to verify:** Submit a deterministic training job on a small dataset; rerun and verify artifact checksum or confirm expected deterministic outputs.

# # 2) Model registry & lineage
- **Requirement:** Register a model, record artifactId, codeRef, datasetRefs, evaluation metrics, and signerId/signature. Lineage queries return parent models and dataset provenance.
- **How to verify:** Register model with associated artifacts and dataset, query model metadata and lineage, and verify stored signature/provenance matches artifact.

# # 3) Secure promotion & signing
- **Requirement:** Promotion to staging/prod requires successful evaluation, SentinelNet clearance, and a ManifestSignature; high-risk promotions require multisig.
- **How to verify:** Attempt to promote without signature or with failing checks — promotion must be rejected. Perform a valid promotion and verify signature recorded and audit event emitted.

# # 4) Serving, canary & rollback
- **Requirement:** Deploy a model; perform canary rollout with traffic shift and automatic rollback when injected regressions occur.
- **How to verify:** Deploy model to staging with canary config, run canary tests; inject regression test to trigger rollback and verify rollback completed and audit events emitted.

# # 5) Drift detection & retrain suggestion
- **Requirement:** Drift detection pipeline monitors input/output distributions; when threshold exceeded it raises alert and suggests retrain jobs with dataset slices.
- **How to verify:** Simulate input distribution shift, confirm drift detection fires an alert and a retrain suggestion is recorded with dataset refs.

# # 6) Compute orchestration & checkpointing
- **Requirement:** Distributed training jobs run on requested compute pool, checkpoint periodically, and handle preemption by resuming from latest checkpoint. GPU hours and resource usage are tracked for Finance.
- **How to verify:** Run job on spot instances, force preemption, confirm job resumes from checkpoint and usage logged to Finance.

# # 7) Artifact & dataset governance
- **Requirement:** Artifact uploads produce checksums and are stored in S3 with proper metadata and immutability for audit; datasets register lineage and license info; PII-marked datasets are blocked until approved.
- **How to verify:** Upload artifact and dataset, check S3 metadata and immutability flags; attempt training with PII dataset without approval and confirm SentinelNet blocks.

# # 8) SentinelNet & policy enforcement
- **Requirement:** SentinelNet blocks disallowed dataset use, prevents promotion for flagged safety issues, and can quarantine serving deployments.
- **How to verify:** Create a policy to block a dataset or promotion; attempt blocked action and confirm SentinelNet decision and `policyCheck` audit event.

# # 9) Model watermarking & provenance proofs
- **Requirement:** Models promoted to production include watermark/proof metadata and signed manifest. Verification tool confirms signature and provenance chain.
- **How to verify:** Promote model, run verification tool to validate signature and provenance metadata.

# # 10) Observability & SLOs
- **Requirement:** Export metrics for training job duration, GPU utilization, serving latency (p95), drift score, retrain frequency, and cost; tracing end-to-end for train→deploy→serve flows. Define SLOs (e.g., p95 inference latency) and configure alerts.
- **How to verify:** Validate metrics on dashboards, run load test to measure SLO compliance, and trigger an alert scenario.

# # 11) Backup, snapshot & replay
- **Requirement:** Artifact snapshots and dataset snapshots are archived to S3 with checksums; restore drill for a sample artifact and model registry DB succeeds.
- **How to verify:** Run restore drill: restore model artifact and registry DB to staging and verify model deployment and serving.

# # 12) Security & key management
- **Requirement:** Signing keys are held in KMS/HSM; signing operations occur via signing proxy; no private keys in cluster. mTLS and RBAC enforced; Vault used for secrets.
- **How to verify:** Inspect signing flow to confirm KMS usage; test mTLS enforcement and check Vault secret injection.

# # 13) Integration & audit events
- **Requirement:** All major actions (train job start/complete, artifact upload, model promotion, deploy/rollback, retrain) emit AuditEvents linking to manifest/signature and are verifiable via audit chain.
- **How to verify:** Trigger flows and verify corresponding AuditEvents exist and pass chain verification.

# # 14) Tests & automation
- **Requirement:** Unit tests for canonicalization and provenance; integration tests covering train→artifact→register→promote→deploy; chaos tests for preemption and node failure.
- **How to verify:** Run CI test suites and chaos tests in staging; ensure pass and stability.

# # 15) Performance & scale
- **Requirement:** Training orchestration scales to the documented target throughput; serving meets latency SLO under expected load; autoscaling functions correctly.
- **How to verify:** Run load and scale tests, confirm metrics and autoscaling behavior.

# # 16) Documentation & sign-off
- **Requirement:** `ai-infra-spec.md`, `deployment.md`, `README.md`, and this acceptance-criteria file are present and reviewed. Security Engineer and ML Lead must sign off; final approver is Ryan.
- **How to verify:** Confirm files exist and obtain written sign-off recorded in the audit bus.

---

# # Final acceptance statement
AI & Infrastructure is accepted when all above checks pass in a staging environment, automated tests green, audit integrity verified, SentinelNet checks enforced, and formal sign-off by Ryan and the Security Engineer is recorded.


