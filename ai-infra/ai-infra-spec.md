# AI & Infrastructure — Specification

## Training job model
- `training_job`: includes codeRef, container_digest, hyperparams, dataset_refs, seed.

## API
### `POST /ai-infra/train`
- Submit training job; returns `job_id`.

### `POST /ai-infra/register`
- Register model artifact with `artifact_id` and `manifestSignatureId`.

### `POST /ai-infra/promote`
- Promote to staging/prod with SentinelNet clearance and signature.

## Lineage & audit
- Model registry exposes lineage queries and signed manifests.

