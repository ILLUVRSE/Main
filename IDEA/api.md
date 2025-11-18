# IDEA — API & Contract

**Base URLs (examples)**

* Local dev: `http://localhost:8200`
* Staging/prod: `https://idea.{env}.illuvrse.internal`

**Security**

* Kernel-authenticated writes: mTLS (preferred) or Kernel-signed tokens (server-side).
* Human/operator actions: OIDC / SSO. Roles: `submitter`, `approver`, `auditor`, `superadmin`.
* All state-changing requests must include `X-Request-Id` (trace) and may use `Idempotency-Key` for deduplication.

**Global headers**

* `X-Request-Id` — UUID for tracing
* `Idempotency-Key` — string (optional but recommended for write ops)
* `Authorization` — `Bearer <token>` or mTLS client cert

**Canonical success/error envelopes**

* Success:

```json
{ "ok": true, ... }
```

* Error:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable explanation",
    "details": { /* optional structured info */ }
  }
}
```

**Audit obligations**

* Every state-changing endpoint must cause an AuditEvent to be emitted with `prevHash`, `hash`, `signature` (or kernel-linked signed event), `actor`, `request_id` and `ts`. For manifest creation and publish flows the audit must include `manifestSignatureId` (when available) and any multisig/upgrade references.

---

## Endpoints

### 1) `POST /packages/submit` — submit a package for validation and processing

**Purpose:** Accept a package (binary or metadata), register it, and start validation jobs.

**Security:** OIDC `submitter` or higher.

**Request body (JSON `multipart/form-data` acceptable):**

```json
{
  "package_name": "my-product",
  "version": "1.2.3",
  "uploader": "user:alice@example.com",
  "artifact_s3_key": "s3://idea-bucket/pack-123.tar.gz",
  "metadata": {
    "description": "short description",
    "tags": ["ml", "vision"]
  },
  "idempotency_key": "submit-uuid-123"
}
```

**Responses:**

* `201` — accepted:

```json
{ "ok": true, "package_id": "pkg-uuid-1", "status": "validation_pending" }
```

* `400` — invalid payload
* `401/403` — unauthorized

**Semantics**

* Record package metadata and create validation jobs (security, license, sandbox smoke).
* Emit `idea.package.submitted` AuditEvent with package_id and initial metadata.

---

### 2) `GET /packages/{package_id}` — fetch package record & validation status

**Purpose:** Retrieve package metadata, validation status, and validation artifacts.

**Response example:**

```json
{
  "ok": true,
  "package": {
    "package_id": "pkg-uuid-1",
    "name": "my-product",
    "version": "1.2.3",
    "status": "validated",    // validating | validated | failed
    "validation_report_url": "s3://...",
    "created_at": "...",
    "metadata": { ... }
  }
}
```

---

### 3) `POST /packages/{package_id}/validate` — (re)trigger validation

**Purpose:** Trigger validation pipeline (SAST, SCA, sandbox tests, PII scan).

**Security:** OIDC `submitter` or `approver`.

**Responses:**

* `202` — validation started
* `400/404` — package not found or invalid
* `403` — unauthorized

**Semantics**

* Accepts `simulate=true` for dry-run in prod (no side effects) and supports `priority` flag.
* Emit `idea.package.validation.started` AuditEvent.

---

### 4) `POST /manifests/create` — create a manifest from a validated package

**Purpose:** Build a manifest that describes the upgrade/package to be applied/published.

**Security:** OIDC `submitter` (draft) / `approver` to finalize, Kernel for signing request.

**Request body:**

```json
{
  "package_id": "pkg-uuid-1",
  "target": { "type": "marketplace", "env": "staging" },
  "rationale": "release notes and reasons",
  "preconditions": { "validation_report": "s3://...", "safety_checks": "passed" },
  "impact": "MEDIUM",  // LOW | MEDIUM | HIGH | CRITICAL
  "apply_strategy": { "canary": { "percent": 5, "duration_minutes": 60 } },
  "idempotency_key": "manifest-create-123"
}
```

**Responses**

* `201` — manifest draft created:

```json
{ "ok": true, "manifest_id": "manifest-uuid-1", "status": "draft" }
```

* `400/403` — error

**Semantics**

* Create manifest draft, persist preconditions and links to validation artifacts.
* If `impact` is HIGH/CRITICAL, manifest lifecycle must support multisig activation. Return `status: pending_multisig` if multisig required and not yet initialized.
* Emit `idea.manifest.created` AuditEvent.

---

### 5) `POST /manifests/{manifest_id}/submit-for-signing` — request Kernel sign

**Purpose:** Submit the manifest to Kernel for signing (`POST /kernel/sign`) over mTLS.

**Security:** Server-side action performed by IDEA service using mTLS credential.

**Behavior & responses**

* `200` — Kernel returned signed manifest:

```json
{ "ok": true, "manifest_id": "manifest-uuid-1", "manifestSignatureId": "manifest-sig-abc", "signed_manifest": { /* signed JSON */ } }
```

* `503` — kernel or signer unavailable (retryable)
* `403` — signing rejected

**Semantics**

* IDEA must verify signature using Kernel public key registry and persist `manifestSignatureId`. Emit `idea.manifest.signed` AuditEvent including manifestSignatureId and signer_kid.

---

### 6) `POST /manifests/{manifest_id}/request-multisig` — (if required) create multisig upgrade manifest

**Purpose:** When manifest impact is HIGH/CRITICAL, request multisig activation by creating an upgrade manifest and returning upgrade id for approvers.

**Security:** `approver` role or server-side flow.

**Response**

* `202` — multisig upgrade created:

```json
{ "ok": true, "upgrade_id": "upgrade-uuid-1", "status": "pending_multisig", "manifest_id": "manifest-uuid-1" }
```

**Semantics**

* Provide data for Control-Panel or Kernel multisig flow; do not apply upgrade until Kernel signals quorum/approved.
* Emit `idea.manifest.multisig_requested` AuditEvent.

---

### 7) `POST /manifests/{manifest_id}/apply` — apply the manifest (publish/execute)

**Purpose:** Apply the manifest to target (publish to marketplace, trigger RepoWriter commit, etc.). This is only allowed when:

* manifest is signed, and
* multisig preconditions satisfied (if required), and
* validation preconditions are satisfied.

**Security:** Server-side with Kernel mediation. Kernel should verify prior to final apply.

**Responses**

* `200` — applied:

```json
{ "ok": true, "manifest_id": "manifest-uuid-1", "status": "applied", "applied_at": "..." }
```

* `403` — not authorized or preconditions not met
* `409` — already applied

**Semantics**

* Trigger RepoWriter to commit any required repo artifacts (RepoWriter must *not* sign manifests). Trigger Marketplace publish flow.
* For marketplace publish: IDEA should call Marketplace publish endpoint with `manifestSignatureId` and package references; Marketplace performs final verification and listing creation.
* Emit `idea.manifest.applied` AuditEvent; record links to RepoWriter commit and Marketplace listing ids.

---

### 8) `POST /publish/notify` — internal hook for notify publish completion

**Purpose:** Called by RepoWriter/Marketplace/ArtifactPublisher to notify IDEA that publish/delivery succeeded (or failed).

**Request body:**

```json
{
  "manifest_id": "manifest-uuid-1",
  "repo_commit": "https://github.com/ILLUVRSE/Repo/commit/abcd",
  "marketplace_listing_id": "listing-123",
  "delivery_proof_id": "proof-123",   // from ArtifactPublisher
  "status": "published"
}
```

**Responses**

* `200` — acknowledged
* `400/404` — invalid

**Semantics**

* IDEA records final state, links ledger/revenue flows (if applicable), emits `idea.publish.completed` AuditEvent, and triggers post-publish processing (e.g., notify finance for payout).

---

### 9) `GET /manifests/{manifest_id}/status` — check manifest lifecycle status

**Response**

```json
{ "ok": true, "manifest_id": "manifest-uuid-1", "status": "draft|signed|pending_multisig|applied|failed", "history": [ /* events with timestamps */ ] }
```

---

### 10) `GET /health` and `GET /ready`

* `GET /health` — service health check (`ok`)
* `GET /ready` — readiness: DB, Kernel connectivity, signer availability (if used), S3 access

---

### 11) Admin / operational endpoints

* `POST /admin/retry-apply` — re-attempt an apply (requires `approver` role and audit log entry)
* `POST /admin/rebuild` — rebuild manifest indexes from audit archive (admin + multisig for destructive ops)
* `GET /metrics` — Prometheus metrics

---

## Contract guarantees & semantics (important)

**Idempotency**

* Endpoints that create records must accept `Idempotency-Key` and return the previous result if same key seen.

**Canonicalization & Signing**

* Manifests must be canonicalized per Kernel rules before submitting to Kernel for signing. IDEA must verify Kernel signature after sign operation.

**Multisig**

* For HIGH/CRITICAL impact, IDEA must create an upgrade manifest and participate in the Kernel multisig lifecycle. IDEA must not apply an upgrade until Kernel reports that upgrade is `applied` per multisig quorum.

**Audit**

* Every write/change must emit an AuditEvent referencing `manifestId`, `manifestSignatureId` (if available), `actor`, `request_id`, `prevHash`, `hash`, and `signature` (or reference to Kernel-signed event).

**Policy & SentinelNet**

* Before final apply (publish), IDEA is encouraged to call SentinelNet to run a policy check for cross-cutting policies (PII, export controls, legal-hold). If SentinelNet denies, IDEA must block apply and surface the policy rationale.

---

## Examples & acceptance tests

**Create manifest & sign**

```bash
# create manifest
curl -X POST https://idea.local/manifests/create -H "Authorization: Bearer <token>" -d @manifest_payload.json

# submit for kernel sign (server step, IDEA uses mTLS)
curl --cert $KERNEL_CLIENT_CERT --key $KERNEL_CLIENT_KEY -X POST https://kernel.local/kernel/sign -d @manifest.json
```

**Multisig scenario**

* Create manifest with `impact: HIGH` → `POST /manifests/:id/request-multisig` → check upgrade id → Control-Panel/Ker nel multisig flows run → when Kernel reports apply, call `POST /manifests/:id/apply`.

**Publish flow**

* After `apply`, IDEA must call RepoWriter and Marketplace, and validate final audit/delivery proofs.

---

## Observability & metrics (recommended)

* `idea.packages.submitted_total`
* `idea.validation.duration_seconds`
* `idea.manifests.created_total`
* `idea.manifests.signed_total`
* `idea.manifests.applied_total`
* `idea.multisig.pending_total`
* `idea.manifests.apply_latency_seconds`

---

## Final signoffs

* Required: `IDEA/signoffs/security_engineer.sig` and `IDEA/signoffs/ryan.sig` before final acceptance.
* Ensure `idea` AuditEvents are verifiable by audit replay tools.

---

End of `IDEA/api.md`.

---
