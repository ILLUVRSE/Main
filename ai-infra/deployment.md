# AI & Infrastructure — Deployment, Security & Runbook

**Purpose**
Guidance to deploy reproducible training pipelines, model registry & lineage, promotion gating (SentinelNet + manifest signatures), model serving canaries and rollbacks, and drift detection. This supports the blueprint acceptance criteria requiring reproducible training, registry lineage, manifest signing, promotion/canary, rollback, and drift detection pipeline.

---

## 0 — Summary / Intent

Run training in reproducible, auditable, and signed workflows: recorded codeRef, datasetRefs, hyperparams, container digests; store artifacts in model-registry with signerId; gate promotion with SentinelNet + manifestSignature; support canary rollout and automatic rollback on regression; detect drift and surface retrain suggestions.

---

## 1 — Topology & Components (high-level)

* **Training Orchestrator** (batch runner / orchestration): schedules training jobs, records codeRef/container digest + dataset checksums, collects artifacts.
* **Model Registry**: stores artifact metadata (artifactId, codeRef, datasetRefs, signerId), manifests, promotion state, canary config.
* **Signing Proxy / KMS**: signs manifests, audit events, and ledger proofs (Ed25519/RSA depending on org).
* **SentinelNet**: policy gating for promotions.
* **Eval Engine / Reasoning Graph**: collect evals and reasoning traces for promotions.
* **Canary Controller / Serving infra**: runs canary deployments and automated rollback on regressions.
* **Drift Detector**: periodic pipeline comparing production distribution to training baseline, emits retrain suggestions.
* **Storage**: object store (S3) for artifacts, model binaries, snapshots; Postgres for metadata/indices.
* **Audit Bus & Indexer**: Kafka → indexer → Postgres + S3 archive.
* **Monitoring/Observability**: Prometheus, Grafana, OTEL.

---

## 2 — Required cloud components & names (exact)

* **Postgres** (>=14) for registry and indexes. Env var: `MODEL_REGISTRY_DATABASE_URL`
* **Object storage (S3)**: `illuvrse-models-${ENV}`, audit archive: `illuvrse-audit-archive-${ENV}` (Object Lock COMPLIANCE)
* **KMS/HSM** for signing (`AUDIT_SIGNING_KMS_KEY_ID`, `MANIFEST_SIGNING_KMS_KEY_ID`)
* **Kubernetes / cluster** for training/serving
* **Kafka/Redpanda** for audit/events
* **CI runner** for reproducible builds (build + push + record digest)
* **Secrets manager** (Vault) for keys/credentials

---

## 3 — Required environment variables (minimum)

```
NODE_ENV=production
MODEL_REGISTRY_DATABASE_URL=postgresql://...
MODEL_REGISTRY_S3_BUCKET=illuvrse-models-${ENV}
AUDIT_SIGNING_KMS_KEY_ID=arn:aws:kms:...
MANIFEST_SIGNING_KMS_KEY_ID=arn:aws:kms:...
MANIFEST_SIGNER_KID=manifest-signer-v1
REQUIRE_KMS=true
REQUIRE_MTLS=true
KERNEL_API_URL=https://kernel.illuvrse.internal
SENTINELNET_URL=https://sentinelnet.internal
DRIFT_S3_BUCKET=illuvrse-drift-${ENV}
PROM_ENDPOINT=...
OTEL_COLLECTOR_URL=...
```

Local dev may use ephemeral keys if `DEV_ALLOW_EPHEMERAL=true`, but `NODE_ENV=production` must fail when `DEV_ALLOW_EPHEMERAL=true`.

---

## 4 — Reproducible training & artifact recording (must-have)

**Principles**

* Record everything that influences model: `codeRef` (commit SHA or image digest), container digest, datasetRefs (dataset id + checksum), hyperparameters, random seeds, environment, training logs, evaluation outputs, and provenance metadata.
* Produce a **training manifest** JSON: `{ artifactId, codeRef, containerDigest, datasetRefs, hyperparams, trainingCmd, artifactSha256, createdAt }`.
* Every artifact registration creates a **manifest** and is **signed** by KMS (or signing proxy) producing a `ManifestSignature` with `signerId`, `signature`, `ts`.

**Implementation checklist**

* Training orchestration records `codeRef`, container digest and dataset checksums at the start and produces artifact with deterministic artifact checksum (sha256).
* Provide a `train --record` helper that:

  * builds container (if local) → record container digest
  * computes dataset checksums (or datasetRefs)
  * runs training with fixed seeds → produce artifact
  * computes artifact sha256 and writes manifest
  * calls model-registry API to register artifact (registry returns `artifactId`)
* CI must be able to reproduce a training run given the manifest (i.e., start from codeRef + container digest + datasetRefs + hyperparams) and reproduce artifact checksum within tolerance.

**Verification command (example)**

```bash
# run a deterministic small training run
TRAIN_DATASET=tests/data/sample \
CODE_REF=gitsha \
CONTAINER_DIGEST=sha256:... \
npm --prefix ai-infra run train:smoke -- --manifest-out=manifest.json

# verify reproducible artifact checksum
sha256sum model.tar.gz
# registry verify:
curl -X POST $MODEL_REGISTRY_API/verify-manifest -d @manifest.json
```

---

## 5 — Model Registry & lineage (MUST include)

**Schema (essential fields)**

* `artifactId` (uuid)
* `artifact_url` (s3)
* `artifact_sha256`
* `codeRef` (git sha or image digest)
* `container_digest`
* `datasetRefs` (list of `{ id, checksum, version }`)
* `signerId` and `manifestSignatureId`
* `metadata` (task, metrics)
* `create_ts`, `created_by`

**APIs**

* `POST /registry/register` — register artifact + manifest (returns artifactId)
* `GET /registry/{artifactId}` — fetch metadata
* `POST /registry/{artifactId}/promote` — request/promote artifact to env (gates apply)
* `GET /registry/promotions/{artifactId}` — promotion history

**Lineage**

* Link datasetRefs to dataset registry records for traceability.
* Provide `tools/export_lineage.sh` to export artifact + dataset + codeRef chain for auditors.

**Verification**

* `python3 ai-infra/tools/verify_manifest.py --artifact-id <id>` verifies artifact sha256, signature, and provenance.

---

## 6 — Promotion, SentinelNet gating & manifest signatures (MUST)

**Promotion flow**

1. Register artifact in registry. Registry stores manifest and returns `artifactId` + manifestSignatureId after signing.
2. Evaluation & Eval Engine produce `promotion` decision and record to Reasoning Graph referencing `manifestSignatureId`.
3. `POST /registry/{artifactId}/promote` triggers:

   * SentinelNet policy check (synchronous or async per policy)
   * If policy requires multisig → return `pending_multisig` until 3-of-5 approvals are collected.
   * If allowed → create promotion record and begin canary deploy.
4. Promotion record must include `promotion_id`, `artifactId`, `target_env`, `manifestSignatureId`, `applied_at`, `status`.

**Manifest signature**

* `MANIFEST_SIGNING_KMS_KEY_ID` used to sign manifests (Ed25519).
* Registry stores signature + `manifestSignatureId`.
* Promotion operations verify manifest signature before proceeding.

**Audit**

* Promotion must emit AuditEvent referencing `manifestSignatureId` and promotion decision.

**Acceptance test**

* `POST /registry/{id}/promote` with a signed manifest → SentinelNet allows → promotion record created and signed.

---

## 7 — Canary strategy & automated rollback (MUST)

**Canary Controller**

* When promotion is approved, controller performs canary rollout:

  * Deploy artifact to small % of traffic (configurable)
  * Monitor evaluation metrics (p95/p99, accuracy, regression thresholds)
  * If regression threshold met, auto-rollback to previous artifact and emit `rollback` audit event.

**Canary config**

* `canary.percent` (e.g., 5%), `canary.window` (duration), `rollback_threshold` (e.g., relative score drop > 0.02)
* Canary should be deterministic by request sampling (seeded by request ids) or traffic split.

**Rollbacks**

* Rollback must be a promotion-like flow requiring signoff for large/critical rollbacks (multisig possible).
* Provide `./scripts/canary_check.sh` for local canary simulation.

**Acceptance**

* Canary success path and rollback path must be covered by tests; auto-rollback test simulates injected regression.

---

## 8 — Drift detection & retrain suggestions (MUST)

**Drift pipeline**

* Periodic job compares production input distribution and model performance against baseline training datasets & evaluation metrics.
* If drift detected above threshold, pipeline emits a retrain suggestion event to Reasoning Graph & logs to registry.
* Implement drift detectors for feature drift, label drift, and performance regressions.

**Implementation**

* `ai-infra/cron/drift_detector.py` or a container job running daily/weekly.
* Store drift reports in S3 and index in registry.

**Acceptance**

* Drift pipeline emits `drift.suggestion` AuditEvent and creates a retrain task when drift > threshold.
* Provide a reproducible `drift/sample` command to simulate drift and verify retrain suggestion.

---

## 9 — Serving & canary serving (MUST)

**Serving**

* Serve models via model-serving infra (KFServing, Triton, or custom).
* Serving infra must validate manifestSignatureId and record serving metadata in registry.

**Canary serving**

* Support traffic split and blue/green deployments.
* Health checks include model-specific metrics; failing thresholds trigger rollback.

**Observability**

* Serve metric types: `model_inference_latency_seconds`, `model_inference_error_rate`, `model_prediction_quality` (if label feedback exists).

---

## 10 — Backup & DR (MUST)

* **Artifacts**: keep model artifacts in S3 with versioning + lifecycle; keep copies in cold storage for compliance.
* **Registry DB**: PITR + daily snapshots; monthly restore drills.
* **Replay**: ability to re-run `verify_manifest` and `audit-verify` against S3 archive to validate chain.
* **DR drill**: restore registry DB + S3 artifact snapshot → run `ai-infra/tools/rebuild_registry_index.py` → run parity/verification.

---

## 11 — Security & governance (MUST)

* **KMS/HSM**: Mandatory for manifest signing in prod. Configure `MANIFEST_SIGNING_KMS_KEY_ID`.
* **Public key distribution**: registry verifier endpoint or update `kernel/tools/signers.json` (public keys).
* **RBAC & mTLS**: Kernel ↔ registry and controllers must use mTLS. Admin UI uses OIDC.
* **No private keys in repo**: enforce secrets scanning in CI.
* **Multisig**: high-risk promotions/rollbacks must use Kernel multisig.

**IAM sample policy (KMS)**

```json
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Effect":"Allow",
      "Action":["kms:Sign","kms:Verify","kms:GetPublicKey"],
      "Resource":"arn:aws:kms:REGION:ACCOUNT:key/MANIFEST_SIGNING_KEY"
    }
  ]
}
```

---

## 12 — CI & reproducible builds

* **Training artifacts**: CI job must be able to reproduce training artifacts (or run a smoke deterministic training to verify manifest).
* **Builds**: build training container images and record digest; treat container digest as `codeRef` for reproducibility.
* **Protected branch guards**: enforce `REQUIRE_KMS=true` and secrets scanning.

**Example CI tasks**

* `ai-infra-ci.yml`:

  * lint, unit tests, reproducible training smoke test, manifest signing mock test, registry contract tests.

---

## 13 — Tests & acceptance hooks

* Unit tests:

  * canonicalization parity, manifest creation, verify manifest signatures.
* Integration tests:

  * Train→register→sign→promote→canary→rollback flow in staging (mock SentinelNet toggles).
* Drift test:

  * simulate drift → verify retrain suggestion event.
* Canary test:

  * inject regression during canary → verify auto rollback triggers and emits audit.

**Example test commands**

```bash
# smoke reproducible training
npm --prefix ai-infra run train:smoke

# registry acceptance
python3 ai-infra/tools/verify_manifest.py --artifact-id <id>

# promotion flow e2e (staging with mocks)
./ai-infra/scripts/e2e_promotion_flow.sh
```

---

## 14 — Runbooks (must exist)

* `ai-infra/runbooks/key_rotation.md` — how to rotate manifest signing keys and update verifier registry.
* `ai-infra/runbooks/manifest_issues.md` — investigate parity/signature issues.
* `ai-infra/runbooks/canary_rollback.md` — handle automatic rollback and postmortem.
* `ai-infra/runbooks/drift_drill.md` — run drift detection drill.

---

## 15 — Observability & SLOs (MUST)

**Metrics**

* `ai_infra.training_job_duration_seconds` (histogram)
* `ai_infra.artifact_registration_latency_seconds`
* `ai_infra.promotion_latency_seconds`
* `ai_infra.canary_rollbacks_total`
* `ai_infra.drift_suggestions_total`

**SLOs (examples)**

* Training orchestration job startup (p95 < 30s for small jobs).
* Artifact registration p95 < 500ms.
* Promotion flow p95 < 2s (assuming async gating).
* Canary rollback response within X minutes of metric violation threshold.

---

## 16 — Sign-off & acceptance criteria

AI & Infrastructure is accepted when:

* Deterministic small training runs reproduce artifact checksum (reproducibility test).
* Model registry stores `artifactId`, `codeRef`, `datasetRefs`, `signerId` and `manifestSignatureId` with verification tooling passing.
* Promotion gating with SentinelNet and manifest signatures: `POST /registry/{artifact}/promote` tested end-to-end.
* Canary rollouts with automated rollback on injected regressions tested in staging.
* Drift detection pipeline exists and emits retrain suggestions when threshold crossed.
* KMS/HSM used for manifest signing in staging/prod and `REQUIRE_KMS=true` enforced in CI.
* Audit chain verification tools verify sample artifacts and promotions (`kernel/tools/audit-verify.js` + registry checks).
* Runbooks, DR drills, and CI guardrails exist.
* Signoffs: `ai-infra/signoffs/ml_lead.sig` and `ai-infra/signoffs/security_engineer.sig`.

---

## 17 — Reviewer commands (quick)

```bash
# reproducible training smoke
npm --prefix ai-infra ci
npm --prefix ai-infra run train:smoke

# verify manifest & signature
python3 ai-infra/tools/verify_manifest.py --manifest manifest.json

# run promotion e2e (staging with mocks)
./ai-infra/scripts/e2e_promotion_flow.sh

# run drift detection sample
python3 ai-infra/cron/drift_detector.py --sample
```

---
