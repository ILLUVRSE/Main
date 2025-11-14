# AI & Infrastructure — Core Module

## Purpose
AI & Infrastructure owns model training orchestration, the model registry, artifact governance, SentinelNet-gated promotion flows, and provenance documentation so every model promoted to staging/prod is reproducible, signed, and auditable.

## Location
All files live under `~/ILLUVRSE/Main/ai-infra/`.

## Files
- `ai-infra-spec.md` — responsibilities + flows.
- `deployment.md` — infra guidance (training clusters, registry DB, signing).
- `acceptance-criteria.md` — required checks.
- `sql/migrations/` — Postgres schema (training jobs, artifacts, promotions).
- `cmd/ai-infra-service/` + `internal/` — Go service for train/register/promote APIs.
- `internal/acceptance/` — end-to-end tests (train → register → promote).

## How to use this module
1. **Read the spec + criteria** — they define reproducibility, lineage, promotion gating, drift detection, and rollback expectations.  
2. **Apply schema**  
   ```bash
   psql "$DATABASE_URL" -f ai-infra/sql/migrations/001_init.sql
   ```
3. **Start the service** (requires an Ed25519 private key in base64 or a KMS endpoint):
   ```bash
   export AI_INFRA_SIGNER_KEY_B64=$(./scripts/generate-ed25519-key.sh) # skip if using KMS
   AI_INFRA_DATABASE_URL=$DATABASE_URL \
   AI_INFRA_ALLOW_DEBUG_TOKEN=true AI_INFRA_DEBUG_TOKEN=dev \
   AI_INFRA_KMS_ENDPOINT=https://kms.dev.internal \
   go run ./ai-infra/cmd/ai-infra-service --run-runner
   ```
4. **Call the APIs**
   - `POST /ai-infra/train` → record training job provenance (codeRef, container digest, hyperparams, datasets, seed).  
   - `POST /ai-infra/register` → register artifact + checksum; service hashes & signs payload, stores signerId/signature, and optional `manifestSignatureId`.  
   - `POST /ai-infra/promote` → run SentinelNet gating (quality threshold), record decision, and if approved sign the promotion manifest for staging/prod.
   - `GET /ai-infra/models` / `GET /ai-infra/models/{id}` → list artifacts or inspect a single artifact + promotion history.
5. **Run acceptance test**  
   `go test ./ai-infra/internal/acceptance -run Promotion` ensures train→register→promote works, SentinelNet blocks low-quality promotions, and signatures + provenance are recorded.

## Security & governance
- Provide the signer key via Vault/KMS (never commit private keys).  
- Promotions require SentinelNet approval (`AI_INFRA_MIN_PROMO_SCORE` sets quality threshold).  
- Audit events should be emitted when integrating with Kernel/Audit Bus (stubs sign artifacts/promotions now).

## Deterministic training runner
- Enable via `AI_INFRA_RUNNER=true` or pass `--run-runner` to the binary. The worker polls queued jobs, marks them running, deterministically computes checksums from job metadata, writes an artifact at `s3://ai-infra-dev/artifacts/<jobID>.model`, registers it via the service, and marks the job completed (or failed on error).
- Use this flow locally/in CI for fast train→register→promote coverage. In production you can replace the runner with Kubernetes Jobs/Argo workflows that read from `training_jobs` and still invoke `RegisterArtifact`—the checksum helper in `internal/runner` keeps artifacts reproducible regardless of executor.

## KMS-backed signing
- If `AI_INFRA_KMS_ENDPOINT` is set the service sends signing requests to `POST $AI_INFRA_KMS_ENDPOINT/sign` with `{payload_b64}` and expects `{signature_b64, signer_id}`. Timeouts + retries are handled in `internal/signing`.
- When the env var is unset, the service falls back to the Ed25519 key provided by `AI_INFRA_SIGNER_KEY_B64`. This is ideal for dev/test but production should rely on KMS/HSM-backed keys with rotation policies managed by Ops.

## Acceptance & sign-off
Module is accepted when all criteria in `acceptance-criteria.md` are met in staging (reproducible training, registry lineage, signed promotions, canary/rollback, drift detection). Final approver: **Ryan (SuperAdmin)** with Security + ML leads.
