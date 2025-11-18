**Purpose**  
IDEA is the orchestrator that takes product packages from submitters, runs validation and safety checks, builds canonical manifests, coordinates multisig handoffs for high-impact changes, requests Kernel signing of manifests, and hands packages off to RepoWriter / Marketplace / ArtifactPublisher for publication and delivery. All state changing operations are audited and must be verifiable by platform audit tooling.

This README explains where things live, how to run local validations, and the acceptance gates required by the platform final completion blueprint.

---

## Repository layout (important files)
```

IDEA/
├─ acceptance-criteria.md
├─ api.md
├─ deployment.md
├─ README.md          <- this file
├─ scripts/           <- helpers and e2e scripts
├─ runbooks/          <- operational runbooks
├─ signoffs/
│  └─ ryan.sig        <- final approver (created)
└─ tests/
└─ integration/    <- e2e integration tests

````

**Signoffs**
- `IDEA/signoffs/ryan.sig` — final approver (SuperAdmin).  
- `IDEA/signoffs/security_engineer.sig` — Security Engineer (expected).

---

## Quick overview of responsibilities
- Accept package submissions (binary or S3 pointer).
- Run validation pipeline (SAST, SCA, sandbox smoke, PII/compliance checks).
- Create canonical **manifest** that describes the upgrade/package.
- Submit manifest to Kernel for signing and persist `manifestSignatureId`.
- Coordinate multisig handoffs for HIGH/CRITICAL-impact manifests via Control-Panel/Kernel.
- Trigger RepoWriter / Marketplace flows and record final publish/delivery proofs.
- Emit append-only AuditEvents at each state transition (submit, validate, manifest.create, manifest.signed, manifest.apply, publish.complete).

---

## Security & governance highlights
- **mTLS** required for kernel interactions (production). `REQUIRE_MTLS=true` must be enforced.  
- **KMS/HSM** (via Kernel) is used for manifest signing; IDEA must never hold private signing keys.  
- All write operations must emit an AuditEvent that follows kernel canonicalization and signing rules. See `eval-engine/audit-log-spec.md` for canonical shape and verification.  
- High-impact flows must follow Kernel multisig flow; IDEA must not apply manifests that require multisig until Kernel reports `applied`.

---

## Developer quick start (local)
Requirements: Node 18+, npm, docker (for sandbox), and access to a local or staging Kernel mock for signing.

```bash
# install dependencies
npm ci --prefix IDEA

# run local Kernel mock and services (example orchestrator)
# (This repo may provide a helper script: IDEA/scripts/run-local.sh)
./IDEA/scripts/run-local.sh

# submit a package (example)
curl -X POST http://localhost:8200/packages/submit \
  -H "Content-Type: application/json" \
  -d '{
    "package_name":"demo-product",
    "version":"0.1.0",
    "artifact_s3_key":"s3://local/pack-1.tar.gz",
    "metadata":{"owner":"alice"}
  }'

# trigger manifest creation and request kernel signing (server-side step):
# IDEA will call Kernel via mTLS, so ensure Kernel mock is running and DEV_SKIP_MTLS=true for dev or proper certs for mTLS.
````

---

## Acceptance & reviewer checklist (blocking items)

The blueprint requires the following artifacts and checks to be present and passing for IDEA acceptance:

* `IDEA/acceptance-criteria.md` — present and green (unit/integration tests).
* `IDEA/api.md` — canonical API contract (present).
* `IDEA/deployment.md` — deployment/runbook (present).
* Validation pipeline exists and demonstrates:

  * Static/License/SCA checks,
  * Sandbox smoke tests,
  * PII / compliance detection.
* **Manifest signing**:

  * IDEA posts manifest to Kernel `POST /kernel/sign` (mTLS) and receives `manifestSignatureId`.
  * Signed manifest verified using Kernel public keys.
* **Multisig flow**:

  * For HIGH/CRITICAL manifests, IDEA requests multisig and waits for Kernel-applied state before apply.
  * Emergency apply flow supported with retroactive ratification.
* **Publish flow**:

  * RepoWriter commits required repo artifacts (RepoWriter must not sign manifests).
  * Marketplace receives manifestSignatureId and creates listing; ArtifactPublisher proves delivery.
* **Audit**:

  * Every step emits AuditEvent; audit replay (`scripts/run_final_audit.sh` / `kernel/tools/audit-verify.js`) verifies IDEA events.
* **Runbooks**:

  * `IDEA/runbooks/manifest_issues.md`, `IDEA/runbooks/multisig.md`, and `IDEA/runbooks/publish_retries.md` exist and are validated by reviewers.
* **Signoffs**:

  * `IDEA/signoffs/security_engineer.sig` (Security Engineer — create during review)
  * `IDEA/signoffs/ryan.sig` (Final approver — already present)

---

## Commands reviewers should run

These are suggested commands for verifying IDEA functionality during review:

```bash
# Run unit & integration tests
npm ci --prefix IDEA
npm test --prefix IDEA

# Validate an example package locally
node IDEA/scripts/validate_package.js --package ./tests/data/sample_package.tar.gz

# Request manifest signing (requires Kernel)
# IDEA will run a server-side operation that calls Kernel; run the IDEA service locally first
curl -X POST http://localhost:8200/manifests/create -H "Content-Type: application/json" -d @manifest_payload.json

# Trigger multisig e2e (requires Control-Panel / Kernel mocks)
./IDEA/scripts/e2e_multisig.sh

# Run audit verification for IDEA events once generated
scripts/run_final_audit.sh
```

---

## How to produce acceptable signoff evidence

* Attach CI logs showing validation & manifest-signing passing.
* Attach Kernel-signed manifest (`manifestSignatureId`) and provide the verification command output verifying the signature.
* For multisig flows include Control-Panel logs and Kernel `AppliedUpgradeRecord` evidence.
* Attach audit-verify output proving IDEA events were correctly emitted and verified.

---

## Notes & links

* Canonical audit spec: `eval-engine/audit-log-spec.md`.
* Kernel verifier registry: `kernel/tools/signers.json`.
* Multisig patterns and Control-Panel flow: see `control-panel/deployment.md`.
* Model & marketplace handoff details: `marketplace/acceptance-criteria.md` and `RepoWriter/docs/PRODUCTION.md`.

---

## Contacts & sign-off

* Module owner: *insert owner name/email*
* Security owner: *insert security engineer name/email*
* Final approver (SuperAdmin): Ryan Lueckenotte — see `IDEA/signoffs/ryan.sig`

---

End of `IDEA/README.md`.

```
