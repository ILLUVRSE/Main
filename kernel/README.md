# Kernel — Core Module

## # Purpose
This directory contains the canonical Kernel API & Governance artifacts for ILLUVRSE. The Kernel is the single source of truth for orchestration, signing, audit, and policy enforcement. Everything in the platform depends on this module.

## # Where this lives
Save all files for this module under:
~/ILLUVRSE/Main/kernel/

## # Files in this module
This folder contains the following files (one per the agreed single-file workflow):

- `kernel-api-spec.md` — human-readable purpose, responsibilities, minimal endpoints, canonical models, security rules, audit, and acceptance criteria.
- `openapi.yaml` — formal OpenAPI contract for the Kernel endpoints and schemas.
- `data-models.md` — canonical data models with required fields, types, DB hints, and examples.
- `security-governance.md` — RBAC, SSO/mTLS, KMS/HSM signing rules, key rotation and compromise procedures, SentinelNet responsibilities, multi-sig policy.
- `audit-log-spec.md` — audit event schema, canonicalization/hashing, storage, retention, verification and export for auditors.
- `multisig-workflow.md` — concrete 3-of-5 upgrade/rollback workflow, emergency path, and tests.
- `api-examples.md` — plain-English request/response examples for the most common flows.
- `acceptance-criteria.md` — testable, verifiable criteria to accept this module as correct and live.
- `README.md` — this file.
- `.gitignore` — (create locally) ignore local secrets and runtime files: `db.json`, `keys.json`, `node_modules`, `dist`, `.env`.

## # How to use this module (brief)
1. Read `kernel-api-spec.md` to understand the contract and the authoritative list of endpoints and models.
2. Refer to `openapi.yaml` when implementing or generating server/client stubs. Ensure any implementation exactly matches the OpenAPI schemas.
3. Use `data-models.md` for DB schema and field types. Persist manifests as append-only and reference signatures.
4. Follow `security-governance.md` and `audit-log-spec.md` for signing, key management, and audit obligations — these are mandatory before anything is considered “live.”
5. Use `multisig-workflow.md` when proposing any Kernel-level upgrade; do not attempt upgrades without following that process.
6. Validate the implementation using `acceptance-criteria.md`. All checks must pass before sign-off.

## # Sign-off & governance
- Final approver: **Ryan (SuperAdmin)**.
- Required reviewer: **Security Engineer** (for KMS/HSM and SentinelNet rules).
- Obtain sign-off in writing and record the approval as a signed audit event per the Audit Log Spec.

## # Next steps (single action)
Create and commit the `.gitignore` file (one line action) that excludes runtime secrets and DBs, then tell me **“done”** and I will provide that exact `.gitignore` content as the next single file.

---

End of README.

