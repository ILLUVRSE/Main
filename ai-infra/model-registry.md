# AI Infra — Model Registry (API, Schema, & Operational Guide)

## Purpose

The Model Registry stores ML artifacts and their provenance, exposes promotion/canary APIs, records manifest signatures, and provides verification tooling so promotions and deployments are auditable and reproducible. It integrates with Kernel (signing), SentinelNet (policy), Eval Engine (evaluations), and the Canary Controller (serving).

---

## Principles & non-negotiables

* **Provenance first** — every artifact must record `codeRef`, `containerDigest`, `datasetRefs`, `hyperparams`, training metadata, and artifact checksum (`artifact_sha256`).
* **Signed manifests** — manifests that describe promotions must be signed by Kernel and referenced via `manifestSignatureId`.
* **Reproducibility** — given a manifest (codeRef + container digest + datasetRefs + hyperparams) should reproduce artifact checksum in CI/staging.
* **Auditability** — every registry action emits AuditEvent that links to Kernel audit chain.
* **KMS / HSM** — signing handled by Kernel/KMS; the registry consumes and verifies signatures, not sign locally.
* **Idempotency** — write endpoints must accept `Idempotency-Key`.

---

## Canonical Registry Schema

A canonical artifact/record stored in the registry:

```json
{
  "artifactId": "uuid",
  "artifact_url": "s3://.../artifact.tar.gz",
  "artifact_sha256": "hex",
  "codeRef": "git-sha-or-image-digest",
  "container_digest": "sha256:...",
  "datasetRefs": [
    { "datasetId": "ds-123", "checksum": "sha256:...", "version": "v1" }
  ],
  "hyperparams": { "seed": 42, "lr": 0.001 },
  "metrics": { "accuracy": 0.92, "loss": 0.3 },
  "created_at": "2025-11-20T12:00:00Z",
  "created_by": "user:alice@example.com",
  "signerId": "manifest-signer-v1",
  "manifestSignatureId": "manifest-sig-123",   // Kernel-signed manifest id
  "metadata": { "task": "image-classification", "framework": "torch" },
  "lineage": { "trainingJobId": "job-123", "parentArtifacts": [] }
}
```

---

## API Contract (canonical endpoints)

> Base URL: `https://model-registry.{env}.illuvrse.internal`
> Security: mTLS for service-to-service, OIDC for human/operator. All writes require `Idempotency-Key` or return same object for duplicate keys.

### `POST /registry/register`

Register a new artifact. Accepts a manifest JSON or metadata. The service stores artifact metadata and returns `artifactId`. It may accept `artifact_url` pointing to S3.

**Request**

```json
{
  "artifact_url": "s3://bucket/artifact.tar.gz",
  "artifact_sha256": "hex",
  "codeRef": "git-sha",
  "container_digest": "sha256:...",
  "datasetRefs": [...],
  "hyperparams": {...},
  "metrics": {...},
  "created_by": "user",
  "metadata": {}
}
```

**Response**

* `201` — `{ "ok": true, "artifactId": "uuid" }`
* `409` — duplicate (idempotency)

**Side effects**

* Emit `registry.artifact.registered` AuditEvent with artifactId and manifest stub.

---

### `GET /registry/{artifactId}`

Fetch artifact metadata, signature references, and promotion history.

**Response**

* `200` — artifact record (see schema)
* `404` — not found

---

### `POST /registry/{artifactId}/verify`

Server-side verification: verify `artifact_sha256` (optionally by fetching artifact), verify manifestSignatureId if present, and verify reproducibility smoke if requested.

**Request**

```json
{ "verify_artifact": true, "verify_manifest_signature": true, "repro_smoke": false }
```

**Response**

* `200` — `{ "ok": true, "results": { "artifact_ok": true, "signature_ok": true, "repro_ok": null } }`
* `400/500` for errors

**Notes**

* This endpoint is used in CI to confirm artifact verification.

---

### `POST /registry/{artifactId}/promote`

Request promotion of an artifact to a target environment. Promotion produces a `promotion_id` and creates a Reasoning Graph Decision node via Eval Engine integration.

**Request**

```json
{
  "artifactId": "uuid",
  "target": { "env": "staging", "traffic_percent": 10 },
  "rationale": "improved accuracy",
  "promotion_metadata": { "promoted_by": "service:eval-engine"},
  "idempotency_key": "promo-uuid"
}
```

**Response**

* `202` — accepted: `{ "ok": true, "promotion_id": "promo-uuid", "status": "pending" }`
* `403` — blocked by SentinelNet / RBAC
* `202` with `status: pending_multisig` if multisig required

**Semantics**

* Before applying, verify `manifestSignatureId` exists and signature is valid.
* Call SentinelNet synchronously (or as required) to obtain policy decision. If the policy requires multisig, return `pending_multisig`.

---

### `GET /registry/promotions/{promotion_id}`

Check promotion status, canary info, trial results, and final outcome.

---

### `POST /registry/{artifactId}/canary`

Trigger an automated canary run (integration with Canary Controller).

**Request**

```json
{ "artifactId": "uuid", "canaryPercent": 5, "duration_minutes": 60, "metrics": ["accuracy","p95_latency"] }
```

**Response**

* `202` — canary started; return `canary_id`.

**Semantics**

* Monitor metrics and if regression threshold exceeded, trigger rollback and emit `registry.canary.rollback` audit.

---

### `POST /registry/{artifactId}/rollback`

Rollback to prior artifact for a target environment. Must be auditable and, for critical rollbacks, may require multisig.

---

### `GET /registry/lineage/{artifactId}`

Return lineage: training job, datasets, parent artifacts, downstream consumers.

---

## Promotion & Multisig Flow (detailed)

1. `POST /registry/{artifactId}/promote` creates Promotion record `promotion_id`.
2. Registry composes a **manifest** describing the promotion and writes a manifest draft.
3. Registry submits manifest to Kernel `POST /kernel/sign` (mTLS) and receives `manifestSignatureId`. Registry persists this.
4. Registry calls SentinelNet to see if policy allows promotion. If `deny`, return `403`. If `requires_multisig`, create an upgrade manifest and return `pending_multisig`.
5. If SentinelNet allows, registry kicks off canary deploy via Canary Controller and records telemetry.
6. On canary success, registry marks promotion `applied` and emits `registry.promotion.applied` AuditEvent referencing `manifestSignatureId`.
7. If canary monitors detect regression, registry triggers `rollback` and emits `registry.promotion.rolled_back` AuditEvent.

**Multisig**

* For HIGH/CRITICAL promotions Registry must initiate an upgrade manifest for Kernel multisig. Do not apply until Kernel returns applied state.

---

## Signature & Verification Semantics

* The registry **does not sign manifests** locally (unless explicitly allowed for non-production). It requests Kernel to sign. Kernel/KMS produces `manifestSignatureId`. The registry must:

  * Store `manifestSignatureId` & signed manifest.
  * Verify signed manifest's signature using `kernel/tools/signers.json` public key entries.
  * For verification, perform canonicalization using the shared canonicalizer and verify `signature` against `hash`.

---

## Reproducibility & CI Integration

* Provide `ai-infra/tools/verify_manifest.py` that:

  * Fetches manifest, artifact, codeRef, container digest, dataset refs.
  * Attempts to reproduce artifact checksum (smoke) if allowed.
  * Verifies manifest signature and signer_kid.

**CI checks**

* `ai-infra-ci.yml` should run:

  * `python3 ai-infra/tools/verify_manifest.py --manifest manifest.json`
  * Reproducibility smoke for simple training job in a small dataset.
  * Contract tests for registry endpoints.

---

## Canary Controller & Telemetry

* Registry emits canary specs to Canary Controller; controller runs canaries and reports back metrics.
* Registry must keep canary policy: `canaryPercent`, `windowMinutes`, `rollbackThreshold` (relative drop), `metricSignals`.
* Registry should track canary history and expose summary at `GET /registry/promotions/{promotionId}`.

---

## Lineage & Audit Integration

* Registry must record lineage and make it queryable via `GET /registry/lineage/{artifactId}`.
* All registry actions emit AuditEvent (e.g., `registry.artifact.registered`, `registry.manifest.signed`, `registry.promotion.request`, `registry.promotion.applied`, etc.) and include `manifestSignatureId` when relevant.
* Integrate with `kernel/tools/audit-verify.js` by ensuring audit events follow canonicalization & signing rules.

---

## Backup, Archival & DR

* Artifacts: store in S3 with versioning and Object Lock for audit compliance.
* Registry DB: PITR + daily snapshot; monthly restore drills.
* Archive exports: export registry metadata + manifests to S3 `registry-archive/YYYY/MM/DD`.
* DR drill: restore DB, run `ai-infra/tools/rebuild_registry_index.py` to repopulate derived indices, and run `kernel/tools/audit-verify.js` against registry-related audit events.

---

## CLI & Example Commands

**Register artifact**

```bash
curl -X POST https://model-registry.local/registry/register \
  -H "Content-Type: application/json" \
  -d @artifact_payload.json
```

**Verify manifest**

```bash
python3 ai-infra/tools/verify_manifest.py --artifact-id <id> --manifest-id <manifestId>
```

**Start canary**

```bash
curl -X POST https://model-registry.local/registry/<artifactId>/canary \
  -H "Content-Type: application/json" \
  -d '{"canaryPercent":5,"duration_minutes":60,"metrics":["accuracy"]}'
```

---

## Monitoring & SLOs

**Registry metrics**

* `model_registry.artifacts_registered_total`
* `model_registry.promotions_total` (labels: status)
* `model_registry.manifest_sign_latency_seconds`
* `model_registry.canary_rollbacks_total`

**SLO examples**

* Manifest sign/verify p95 < 1s (excluding Kernel network time)
* Promotion flow (until canary started) p95 < 3s
* Canary rollback detection p95 within configured window

---

## Tests & Acceptance Checkpoints

Before sign-off the registry must demonstrate:

* Reproducibility smoke for at least one small training job.
* Manifest signing and verification end-to-end with Kernel.
* Promotion flow including SentinelNet gating, canary run and auto-rollback test.
* Multisig promotion test (simulate approvals; ensure registry waits for Kernel applied state).
* Audit chain verification for registry events via `kernel/tools/audit-verify.js`.
* CI guard `REQUIRE_KMS=true` enforced for protected branches.

---

## Runbooks & Recovery

* `ai-infra/runbooks/manifest_issues.md` — how to investigate manifest signature failures.
* `ai-infra/runbooks/canary_rollback.md` — how to investigate and remediate canary rollbacks.
* `ai-infra/runbooks/rebuild_registry_index.md` — restore index from archive and audit.

---

## Sign-offs

Required signoffs for model-registry acceptance:

* `ai-infra/signoffs/ml_lead.sig`
* `ai-infra/signoffs/security_engineer.sig`
* `ai-infra/signoffs/ryan.sig`

---

End of `ai-infra/model-registry.md`.

---
