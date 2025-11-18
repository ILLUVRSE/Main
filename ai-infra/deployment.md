# AI & Infrastructure — Deployment & Ops Guide

Actionable runbook for bringing the AI Infra service (training metadata, model registry, promotion workflow) to production with deterministic training runners, SentinelNet gating, and KMS-backed signing.

---

## 1. Database migrations
Apply the schema before booting any API instance:

```bash
psql "$AI_INFRA_DATABASE_URL" -f ai-infra/sql/migrations/001_init.sql
```

The migration creates `training_jobs`, `model_artifacts`, and `model_promotions` plus indexes used by the runner and registry APIs.

---

## 2. Required configuration

| Env var | Purpose |
| --- | --- |
| `AI_INFRA_ADDR` | Listen address (default `:8061`). |
| `AI_INFRA_DATABASE_URL` | Postgres connection string. |
| `AI_INFRA_SIGNER_KEY_B64` | Base64 Ed25519 private key (fallback when no KMS). |
| `AI_INFRA_SIGNER_ID` | Identifier embedded in signatures (rotate per key). |
| `AI_INFRA_KMS_ENDPOINT` | Optional HTTP signer adapter endpoint (`POST /sign`). |
| `AI_INFRA_MIN_PROMO_SCORE` | Default SentinelNet static threshold when no remote policy. |
| `AI_INFRA_SENTINEL_URL` | Optional SentinelNet base URL for live policy checks. |
| `AI_INFRA_ALLOW_DEBUG_TOKEN` / `AI_INFRA_DEBUG_TOKEN` | Enable/disable debug header auth in dev. |
| `AI_INFRA_RUNNER` | When `true`, start the in-process deterministic training runner. |

Example `.env` for local use:

```
AI_INFRA_ADDR=:8061
AI_INFRA_DATABASE_URL=postgres://aiinfra:dev@localhost:5432/aiinfra?sslmode=disable
AI_INFRA_SIGNER_KEY_B64=<base64-ed25519-private-key>
AI_INFRA_SIGNER_ID=ai-infra-dev
AI_INFRA_MIN_PROMO_SCORE=0.85
AI_INFRA_ALLOW_DEBUG_TOKEN=true
AI_INFRA_DEBUG_TOKEN=dev
AI_INFRA_RUNNER=true
```

Load with `source .env` before running the binary.

---

## 3. Signing & KMS

The service now ships with a signer factory:

- **KMS / HSM (recommended):** set `AI_INFRA_KMS_ENDPOINT=https://kms.internal` (the service POSTs `{payload_b64}` to `/sign` and expects `{signature_b64, signer_id}`). Timeouts + retries are builtin.
- **Local Ed25519 fallback:** omit `AI_INFRA_KMS_ENDPOINT`, provide `AI_INFRA_SIGNER_KEY_B64` + `AI_INFRA_SIGNER_ID`. Keys should come from Vault or ops-managed secrets; never commit private keys.
- Rotation: roll a new key/KMS signing profile, update the env vars, restart pods. Consumers read `signerId` off registry objects to choose verification keys.

---

## 4. SentinelNet policy integration

- Set `AI_INFRA_SENTINEL_URL` to enable the HTTP client that POSTs to `${AI_INFRA_SENTINEL_URL}/sentinelnet/check`. Timeouts and retries are managed inside the client.
- When the URL is unset, the service uses the existing static threshold client (`AI_INFRA_MIN_PROMO_SCORE`).
- Promotions record the entire SentinelNet decision payload; rejections keep policy IDs + reasons for audit.

---

## 5. Training runner & compute

The module now includes a deterministic local runner:

- Enable via `AI_INFRA_RUNNER=true` **or** CLI flag `--run-runner`. The runner polls `training_jobs` with `status=queued`, marks them `running`, computes deterministic checksums (`codeRef || containerDigest || canonical JSON || seed`), simulates training, registers an artifact, and marks the job `completed`.
- Artifact URIs default to `s3://ai-infra-dev/artifacts/<job-id>.model`; customize upstream orchestrators to upload real artifacts to S3/GCS before calling `/ai-infra/register` if you deploy distributed training.
- To swap in production-grade compute, point a Kubernetes Job/Argo Workflow/Ray cluster at the `training_jobs` table. The external worker can reuse the checksum helper from `internal/runner` to stay deterministic and then call the service’s `RegisterArtifact` endpoint. The built-in runner is a safe local fallback or reference implementation.

---

## 6. Artifact storage

- Use an S3-compatible bucket dedicated to model artifacts (e.g., `s3://ai-infra-prod-artifacts`).
- Enable bucket versioning and Object Lock (governance mode) so artifacts are immutable once uploaded.
- Suggested bucket policy: restrict `PutObject` to the training cluster IAM role, `GetObject` to registry + downstream deployment roles, and block public ACLs.
- Maintain a separate audit bucket for manifests/checkpoints if required by compliance. Emit checksum + signer metadata to CloudTrail/S3 Access Logs for lineage verification.

---

## 7. Running the service locally

```bash
# With runner enabled via env var
AI_INFRA_RUNNER=true \
AI_INFRA_ALLOW_DEBUG_TOKEN=true AI_INFRA_DEBUG_TOKEN=dev \
go run ./ai-infra/cmd/ai-infra-service

# OR explicitly run the worker flag
go run ./ai-infra/cmd/ai-infra-service --run-runner
```

Submit a training job:

```bash
curl -H 'Content-Type: application/json' -H 'X-Debug-Token: dev' \
  -d '{"codeRef":"git://repo","containerDigest":"sha256:abc"}' \
  http://localhost:8061/ai-infra/train
```

The runner will pick it up, register an artifact with deterministic checksum/signature, and you can list it via `GET /ai-infra/models`.

---

## 8. Production deployment checklist

1. **Platform**: deploy the API via Kubernetes (≥2 replicas, rolling updates). Add liveness/readiness probes on `/health`, `PodDisruptionBudget`, and NetworkPolicies limiting DB/KMS/SentinelNet access.
2. **Migrations**: ship an init Job (or `atlas migrate`) that runs `001_init.sql` on every release.
3. **Auth**: disable debug tokens (`AI_INFRA_ALLOW_DEBUG_TOKEN=false`) and enforce mTLS at ingress.
4. **Observability**: scrape logs for signature IDs, decision IDs, and runner status. Future work: expose Prometheus metrics for queue depth and SentinelNet latency.
5. **Disaster recovery**: enable PITR on Postgres, back up S3 buckets with Object Lock, and archive promotion manifests/signatures for at least the compliance retention window.
6. **Validation**: run `go test ./ai-infra/...` in CI, then issue a low-quality promotion in staging to confirm SentinelNet denials flow through before promoting to production.

With these steps in place you have a full train → register → promote workflow, deterministic runner for dev/test, production-callable SentinelNet & KMS adapters, and auditable artifact lineage.

---

## 9. Operational runbook
- **Training jobs stuck in `queued`**  
  1. Check runner logs/pod readiness. If runners are disabled intentionally, confirm external orchestrator is writing status updates.  
  2. Inspect `training_jobs` for rows older than SLA; requeue by setting `status='queued'` and bumping `updated_at`.  
  3. If checksum mismatch occurs, confirm `codeRef`, `containerDigest`, and `seed` match orchestrator input; fix upstream pipeline before resuming.
- **Signer/KMS failure**  
  1. Alert fires from `ai_infra_sign_errors_total`. Temporarily enable local fallback by providing `AI_INFRA_SIGNER_KEY_B64` stored in Vault, but only after Security approval.  
  2. Failing KMS endpoint? Rotate IAM creds, test with signer diagnostics (`go run ./cmd/signertest`).  
  3. Re-sign pending promotions by rerunning `promotionService.Finalize` once KMS is back.
- **SentinelNet unreachable**  
  1. Service returns HTTP 5xx when hitting SentinelNet. Automatically degrade by switching to static threshold (unset `AI_INFRA_SENTINEL_URL`, set `AI_INFRA_MIN_PROMO_SCORE`).  
  2. Flag promotion records with `evaluation.fallback=true` for audit. Once SentinelNet recovers, replay pending promotions through `/sentinelnet/check` and update records.
- **Database failover / corruption**  
  1. Trigger managed Postgres failover (or promote replica).  
  2. Run `go run ./cmd/consistency` (future tool) or manual checks to ensure `model_artifacts` rows link to valid `training_jobs`.  
  3. Rebuild read replicas, re-enable writers, and verify `model_promotions` statuses.
- **Artifact integrity breach**  
  1. Compare reported checksum vs stored `model_artifacts.checksum`. If mismatch, revoke artifact, mark promotions `revoked`, and notify downstream deployers.  
  2. Require retraining; delete affected S3 objects via delete markers while keeping immutable copies in audit bucket for forensics.
