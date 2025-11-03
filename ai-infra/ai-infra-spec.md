# AI & Infrastructure — Specification

# # Purpose
Provide a production-grade AI infrastructure stack for ILLUVRSE: model registry, training/fine-tuning pipelines, artifact & dataset lineage, model serving, drift detection, reproducible retraining, cost-aware compute orchestration, and ModelOps. This system enables safe, auditable, and repeatable model lifecycle management at scale under Kernel governance.

---

# # Core responsibilities
- Model registry and metadata (versions, lineage, metrics, signatures).
- Dataset lineage and provenance tracking (sources, transformations, checksums).
- Training/fine-tune orchestration (submit, schedule, run, monitor, artifactize).
- Serving infrastructure (model deployments, autoscaling, canary, A/B).
- Model evaluation, drift detection, fairness and safety checks, and rollback.
- Artifact storage: model binaries, checkpoints, evaluation datasets, logs.
- Reproducibility: record exact environment, seed, codeRef, hyperparams, and dataset refs for every run.
- Cost and quota accounting for GPU/TPU usage and integration with Resource Allocator and Finance.
- Integration with Kernel for signing manifests and audit events, and with SentinelNet for policy checks (e.g., PII usage, export restrictions).
- Model watermarking and provenance proofs; ensure models are signed before promotion.

---

# # Minimal public interfaces (intents)
These are service-level intents (Kernel-authenticated / mTLS):

## # Model registry & metadata
- `POST /models/register` — register a new model family or version (name, version, codeRef, artifactRef, metrics, signerId/signature).
- `GET  /models/{id}` — fetch model metadata, lineage, and status.
- `POST /models/{id}/promote` — promote model to environment (sandbox → staging → prod) after checks (can require multisig for high-risk models).

## # Training & jobs
- `POST /train/jobs` — submit training/fine-tune job (datasetRefs, config, computeRequirements, hyperparams, retrainReason). Returns `jobId`.
- `GET  /train/jobs/{jobId}` — job status, logs, metrics, artifacts.
- `POST /train/jobs/{jobId}/cancel` — cancel job.

## # Serving & deployment
- `POST /serve/deploy` — request model deployment (modelId, version, resources, route, canary config).
- `GET  /serve/{deployId}` — deployment status and endpoints.
- `POST /serve/{deployId}/scale` — scale or adjust rollout.
- `POST /serve/{deployId}/rollback` — rollback to prior model version.

## # Evaluation & drift
- `POST /eval/run` — run evaluation suite (testset refs, metrics config).
- `GET  /drift/{modelId}` — fetch drift metrics and thresholds.
- `POST /drift/alert` — triggered alerts and remediation actions.

## # Artifact & lineage
- `POST /artifact/upload` — upload model/checkpoint; returns artifactId and checksum.
- `GET  /artifact/{id}` — fetch metadata and signed provenance.
- `POST /dataset/register` — register dataset with lineage and checksum.

**Notes:** All mutating calls produce AuditEvents; signing required for production promotions.

---

# # Canonical data models (short)

## # ModelRegistryEntry
- `modelId`, `family`, `version`, `codeRef`, `artifactId`, `metrics` (eval results), `createdAt`, `createdBy`, `status` (`draft|staging|prod|deprecated`), `signerId`, `signature`, `lineage` (dataset refs, parent models), `provenance`.

## # TrainingJob
- `jobId`, `modelFamily`, `datasetRefs`, `hyperparams`, `computeRequirements`, `status`, `startTs`, `endTs`, `logsRef`, `artifactRefs[]`, `metrics`, `createdBy`, `retryPolicy`.

## # DatasetLineage
- `datasetId`, `sourceRefs`, `transformations[]` (with codeRef/checksum), `checksum`, `license`, `piiFlags`, `createdAt`.

## # DeploymentRecord
- `deployId`, `modelId`, `version`, `env` (`sandbox|staging|prod`), `route`, `nodePool`, `resources`, `status`, `canaryConfig`, `createdAt`, `provenance`, `metricsEndpoint`.

---

# # Training & fine-tune pipeline (principles)
- **Reproducibility first:** every run stores codeRef, environment (container image digest), dependency versions, random seed, exact dataset checksums, hyperparams, and compute configuration.
- **Snapshot artifacts:** checkpoints, final model, logs, and evaluation artifacts stored in S3 with checksum and registered artifactId.
- **Immutable runs:** training jobs produce immutable records; corrections are new jobs.
- **Evaluation gates:** automated evaluation (unit tests, fairness checks, safety filters, SentinelNet checks) run before promotion. Failures prevent promotion.
- **Canary promotion:** staged deployment with traffic shifting and monitoring; automatic rollback on SLA/regression detections.

---

# # Model serving & ops
- **Serving primitives:** containerized model servers (TF, PyTorch, Triton, custom runtimes) behind autoscaling proxies.
- **A/B & shadowing:** support A/B routing and shadow traffic to new models for evaluation.
- **SLOs & health:** latency SLOs, request tracing, per-model metrics (p95, error rate), and request-level provenance (model version, signer).
- **Scaling:** autoscale by request rate and scheduled scale for batch workloads. Support GPU autoscaling and pre-warming.
- **Rollback & canary:** automated canary checks (owner-defined metrics) with safe rollback and audit.

---

# # Drift detection & model governance
- **Continuous monitoring:** track input distribution, output distribution, performance degradation, and fairness metrics; compute drift scores.
- **Alerting:** automatic alerts when drift exceed thresholds; create `retrain` suggestions or quarantines.
- **Explainability traces:** link evaluation and drift findings to Reasoning Graph for auditability and root-cause analysis.
- **Human review:** certain drift events or safety violations require human sign-off and possibly multisig before re-deploying.

---

# # Compute orchestration & cost control
- **Compute pools:** define pools (gpu-us-east, tpu-europe, cpu-highmem) with quotas and cost rates. Integrate with Resource Allocator to request and charge GPU hours.
- **Scheduler:** integrate K8s + Ray (or similar) for distributed training; use spot instances for cost savings with checkpointing.
- **Preemption & checkpointing:** support periodic checkpointing and graceful restart on preemption.
- **Accounting:** track GPU hours per job/model and report to Finance for chargebacks.

---

# # Dataset & artifact governance
- **Lineage & licensing:** dataset registration includes license and usage restrictions; SentinelNet blocks usage of restricted datasets.
- **PII & safety:** datasets flagged for PII trigger additional checks and require approval before training. Preprocessing pipelines record escrows of raw PII and produce sanitized derivatives.
- **Retention:** datasets and artifacts retain per policy; old artifacts archived with proofs.

---

# # Security, signing & provenance
- **Model signing:** production model promotions require signature (Ed25519) after successful checks. Signatures stored as ManifestSignature linked to model registry.
- **Provenance:** every model, dataset, and deployment record includes provenance and audit linkage.
- **Watermarking:** apply model watermarking where relevant (to prove model origin and discourage misuse).
- **KMS/HSM:** signing uses KMS/HSM via signing proxy; no private keys stored in app.

---

# # Integration & automation
- **Kernel:** gate promotions, record ManifestSignature links, produce audit events, and handle multisig for high-risk promotions.
- **SentinelNet:** pre-train, pre-promotion, and runtime policy checks (PII, export control, safety).
- **Reasoning Graph & Memory Layer:** store evaluation traces, explainability artifacts, and dataset references for audit.
- **Eval Engine:** feed evaluation metrics and promotion/demotion recommendations into reasoning and allocation flows.
- **Agent Manager:** retrieve trained models, deploy to agent runtime, and ensure provenance on agent side.

---

# # Observability & testing
- **Metrics:** training job durations, GPU utilization, model serving latency/error, drift scores, retrain frequency, cost per model.
- **Tracing & logs:** end-to-end trace for training job (submit → run → artifact → promote) and serving requests.
- **Testing:** unit tests for canonicalization and lineage; integration for full train → evaluate → deploy → canary → promote flows; chaos tests for preemption and node failures.

---

# # Acceptance criteria (minimal)
- **Reproducible runs:** submit a training job and verify that the recorded run (codeRef, env, datasets, seed) produces the same artifact when re-run with same inputs.
- **Model registry:** register a model, store artifact, record lineage, and retrieve metadata and signature.
- **Secure promotion:** model promotion to `prod` requires successful evaluation, SentinelNet clearance, and a ManifestSignature; blocked promotions are rejected.
- **Serving:** deploy a model and serve requests; canary rollout and automatic rollback behavior works as specified.
- **Drift detection:** input/output drift detection raises alerts and can propose retrains.
- **Compute & cost accounting:** GPU hours tracked per job and reported to Finance; allocation requests for GPUs go through Resource Allocator.
- **Audit:** all training, promotion, deployment, and retraining events emit AuditEvents and are verifiable via hash/signature.
- **Security:** PII datasets are blocked until approved; model signing uses KMS and works end-to-end.

---

# # Example flow (short)
1. Data engineer registers `dataset:v1` with lineage and checksums.
2. ML engineer submits `train` job pointing at `dataset:v1` and `codeRef` (`git@...#commit-sha`) requesting `2xA100` in `gpu-us-east`.
3. Scheduler provisions GPUs via Resource Allocator, SentinelNet approves, and training runs using Ray; periodic checkpoints stored in S3.
4. Job completes: artifact uploaded and registered in Model Registry: `family=vision-transformer, version=1.0.0`. Evaluation run passes safety/fairness checks.
5. Kernel requests `POST /models/{id}/promote`; SentinelNet clears policy checks; Kernel issues signature or multisig as required. Model promoted to `staging` and deployed with canary. Canary metrics OK — promoted to `prod`. Audit events recorded at each step.

---

End of file.

