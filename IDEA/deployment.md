# IDEA — Deployment, Security & Runbook

## Purpose

Deploy the IDEA workflow as a hardened, auditable pipeline that produces Kernel-signed manifests, validates packages, enforces multisig handoffs for large changes, and integrates with Marketplace and Finance for checkout and settlement. All state changes must emit signed AuditEvents and be verifiable by audit replay.

---

## 0 — One-line intent

Provide a repeatable, auditable pipeline that turns product packages into Kernel-signed manifests and marketplace listings, with governance (multisig), validation, encrypted delivery, and ledger integration.

---

## 1 — Topology & components

* **IDEA API / Orchestrator** — server that:

  * accepts package submissions,
  * runs validation and preflight checks,
  * creates Kernel manifests,
  * coordinates multisig handoffs via Control-Panel/Kernel,
  * publishes artifacts to RepoWriter/ArtifactPublisher,
  * emits AuditEvents.
* **Validation runners** — sandboxed validators (unit, security, license, compliance).
* **Artifact store** — S3 or equivalent for package storage.
* **Kernel** — signing & audit anchor (mTLS).
* **RepoWriter** — writes manifests/commit artifacts to git/GitHub as required (must not sign manifests).
* **ArtifactPublisher** — encrypted delivery for buyers.
* **Marketplace & Finance** — checkout, ledger postings, and payout flows.
* **Signing/KMS** — used by Kernel; IDEA must not hold private keys.

---

## 2 — Required cloud components & env vars

Minimum components:

* Postgres for metadata (`IDEA_DATABASE_URL`)
* S3 bucket for packages (`IDEA_PACKAGE_BUCKET`)
* Kernel API & mTLS credentials (`KERNEL_API_URL`, `KERNEL_CLIENT_CERT`, `KERNEL_CLIENT_KEY`)
* Vault / Secret manager for runtime secrets
* KMS/Signing proxy config (for kernelsigner interactions; IDEA does not sign locally)
* Job runner infrastructure (K8s jobs / serverless / batch)
* Prometheus / OTEL for metrics/traces

Example env vars:

```
NODE_ENV=production
IDEA_DATABASE_URL=postgresql://...
IDEA_PACKAGE_BUCKET=illuvrse-idea-${ENV}
KERNEL_API_URL=https://kernel.illuvrse.internal
KERNEL_CLIENT_CERT_PATH=/secrets/kernel-client.crt
KERNEL_CLIENT_KEY_PATH=/secrets/kernel-client.key
REQUIRE_MTLS=true
REQUIRE_KMS=true
S3_ENDPOINT=...
S3_REGION=...
S3_ACCESS_KEY=...
S3_SECRET=...
```

---

## 3 — Security & auth (MUST)

* **mTLS** required for server-to-server Kernel calls. `REQUIRE_MTLS=true` in prod.
* **OIDC** for human flows (submitters, approvers), with roles: `submitter`, `approver`, `auditor`, `superadmin`.
* **Least privilege**: IDEA must not store private keys in repo or images. Signing is delegated to Kernel/KMS.
* **Multisig**: For high-impact handoffs, IDEA must create an upgrade manifest and request multisig approvals via Kernel/Control-Panel. IDEA must refuse to proceed if multisig required but not satisfied.
* **Audit**: Each step (submit, validate, manifest create, publish) must emit an AuditEvent with `prevHash`, `hash`, `signature` metadata or reference to Kernel-signed records.
* **Startup guard**: IDEA now calls `infra/startupGuards.ts` at boot, so any environment (CI, staging, prod) with `REQUIRE_KMS`, `REQUIRE_SIGNING_PROXY`, or `REQUIRE_MTLS` set will fail fast if the corresponding signer or mTLS inputs are missing.

---

## 4 — Package validation (MUST)

* Per-package validation pipeline:

  * Static checks: format, license, size, checksum.
  * Security checks: SAST/supply-chain scanning (SCA) and dependency vetting.
  * Functional tests: sandbox run of smoke tests in isolated runner.
  * Compliance checks: PII detection, export controls (if applicable).
* Validation must be reproducible; results are persisted as part of the package record and linked in the manifest `preconditions`.

**Commands (examples)**:

```bash
# local validation
node IDEA/scripts/validate_package.js --package ./pkg.tar.gz --out validation.json
```

---

## 5 — Manifest creation & Kernel signing (MUST)

* IDEA builds a manifest JSON: includes `upgradeId`/`manifestId`, `type`, `target`, `rationale`, `preconditions`, `artifact_ref`, `timestamp`, `proposedBy`.
* IDEA posts manifest to Kernel `POST /kernel/sign` (mTLS) and receives the signed manifest or `manifestSignatureId`.
* IDEA records manifest + signature linkage and emits an AuditEvent noting `manifestSignatureId`.

**Acceptance**:

* Kernel `POST /kernel/sign` succeeded and signature verifies against Kernel signer registry.

---

## 6 — Multisig handoff & control (MUST)

* For `type: manifest` with `impact: HIGH|CRITICAL`, IDEA must:

  * create upgrade manifest,
  * create an `upgrade` draft and notify approvers via Control-Panel flows,
  * not apply the upgrade until Kernel reports `AppliedUpgradeRecord` after 3-of-5 approval.
* Support emergency apply with `emergency=true` and enforce retroactive ratification window (48h), with rollback if ratification fails.

---

## 7 — Publish & marketplace integration (MUST)

* After manifest signing and approvals:

  * IDEA calls RepoWriter to write manifest artifacts (RepoWriter must commit but not sign).
  * IDEA notifies Marketplace to create listing and attach `manifestSignatureId`.
  * Marketplace triggers ArtifactPublisher for encrypted delivery during checkout (artifact publisher emits signed delivery proofs).
* All publisher actions must be auditable and include `manifestSignatureId` and ledger references when payments occur.

---

## 8 — Finance & settlement handoff (MUST)

* IDEA’s publish/checkout flow must include Finance ledger integration:

  * On successful checkout, Marketplace/Finance produce signed ledger proof.
  * IDEA must reference ledger proof IDs in audit chain for product payouts or capital flows if applicable.
* For large handoffs (multi-party revenue splits), IDEA must create a multisig-tracked settlement plan and attach to manifest.

---

## 9 — Observability, SLOs & tests (MUST)

**Metrics**

* `idea.submissions_total`
* `idea.validation_duration_seconds`
* `idea.manifest_sign_latency_seconds`
* `idea.publish_latency_seconds`
* `idea.multisig_pending_total`

**SLOs (examples)**

* Validation p95 < 30s for simple packages (dev), p95 < 2m for larger packages.
* Manifest sign p95 < 500ms (kernel dependent).
* Publish end-to-end (submit → publish) p95 < 30s (staging).

**Tests**

* Unit tests for manifest composition and precondition handling.
* Integration tests: submit → validate → manifest sign → publish → marketplace listing.
* Multisig test: produce upgrade requiring multisig and verify apply only after approvals.
* Audit replay test: ensure the audit chain can be replayed and validated.

---

## 10 — Runbooks (MUST)

Provide:

* `IDEA/runbooks/manifest_issues.md` — how to troubleshoot failed signing or signature verification.
* `IDEA/runbooks/multisig.md` — how to investigate and recover multisig workflows.
* `IDEA/runbooks/publish_retries.md` — retry and DLQ procedures for publish failures.

**Examples**

* **Manifest sign failed**: verify Kernel connectivity, signer registry, check `REQUIRE_KMS` guard, consult Kernel logs, and re-run handshake with Kernel sign endpoint.
* **Publish failed**: check RepoWriter commit logs, RepoWriter audit events, and ArtifactPublisher delivery queue.

---

## 11 — Acceptance & signoff (MUST)

IDEA is ready for final acceptance when:

* Validation pipeline exists and acceptance tests pass.
* Manifests are produced and Kernel signing verified; `manifestSignatureId` referenced in subsequent actions.
* Multisig handoffs operate end-to-end with Kernel.
* Publish flow to RepoWriter & Marketplace completes and delivery proofs are verifiable.
* Audit replay validates IDEA-generated events and chain ties into Kernel archive.
* Signoffs present:

  * `IDEA/signoffs/ryan.sig` (final)
  * `IDEA/signoffs/security_engineer.sig` (security)

---

## 12 — Reviewer quick commands

```bash
# validate package locally
node IDEA/scripts/validate_package.js --package pkg.tar.gz

# request manifest sign
curl -X POST $KERNEL_API_URL/kernel/sign -H "Content-Type: application/json" -d @manifest.json --cert $KERNEL_CLIENT_CERT_PATH --key $KERNEL_CLIENT_KEY_PATH

# simulate multisig flow via Control-Panel / Kernel mock
./IDEA/scripts/e2e_multisig.sh
```

---

End of `IDEA/deployment.md`.

---
