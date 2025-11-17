# Finance — Audit Export Policy (S3 Object Lock & Operational Controls)

**Purpose**
Specify the S3 export policy, object-lock configuration, metadata, and operational controls Finance must follow when exporting ledger rows, proofs, and reconciliation bundles for auditors. This is an operational security and compliance doc: implement these settings exactly for production audits.

**Audience:** SRE / Security / Finance Engineers / Compliance

---

## Overview — requirements (short)

1. **Immutable exports:** All audit exports written by Finance must be immutable using S3 **Object Lock** (Governance or Compliance mode as required by legal).
2. **Separation of buckets:** Use dedicated buckets for `audit-archive` (immutable) and `audit-temp` (transient if needed). Never use the same bucket for normal artifacts and audit archives.
3. **Metadata & manifest:** Every export must include a signed manifest and standardized metadata so auditors can verify provenance and chain integrity.
4. **Access controls:** Restrict bucket access to a minimal set of IAM principals (export job, auditors, security). Use bucket policies and IAM roles.
5. **Encryption:** All exported objects must be encrypted in transit and at rest (SSE-KMS or SSE-S3 with proper key management).
6. **Retention & legal hold:** Retention periods must comply with legal/regulatory requirements; use object-lock retention length or legal hold as policy dictates.
7. **Automation & verification:** Exports must be produced by an automated job and verification (`audit-verify`) must run and succeed for sample exports as part of CI/nightly.

---

## Bucket design & naming

* Example bucket names:

  * `illuvrse-audit-archive-prod` — production immutable archive (Object Lock enabled).
  * `illuvrse-audit-archive-staging` — staging archive (Object Lock if required).
  * `illuvrse-audit-temp-prod` — temp bucket for staging/processing (not Object Lock).
* Bucket ownership: central security/infra account. Finance service uses a scoped IAM role to put objects into `audit-archive-*`.

---

## Object Lock configuration

**Mode:** Use **Compliance** mode if legal requires non-reversible retention (higher assurance), otherwise **Governance** mode with strict IAM enforcement. Document choice, legal justification, and who can remove holds.

**Retention policy**:

* Default retention: `retention_days` configured per org policy (example: 7 years = 2557 days).
* Export job sets object retention at upload time per-object with explicit expiration date in metadata.

**Legal hold**:

* Use legal holds only via documented legal/security procedure. Legal holds override retention expiry and require documented approval.

**Important:** Once Object Lock is enabled on a bucket, it cannot be disabled. Apply to `audit-archive-*` only after careful review.

---

## Export object layout & naming

Each export SHOULD be written as a single top-level prefix per export with deterministic name:

```
s3://illuvrse-audit-archive-prod/finance/YYYY/MM/DD/export-<env>-<service>-<timestamp>-<uuid>.tar.gz
```

Inside the tar.gz (or .jsonl.gz) include:

* `manifest.json` — required (see below).
* `ledger_rows.jsonl.gz` — canonicalized ledger rows (JSONL).
* `proof.json` — signed proof for the ledger range.
* `reconcile_report.jsonl.gz` — optional if export tied to reconciliation.
* `provider_records.jsonl.gz` — optional; provider reports used for reconcile.
* `readme.txt` — optional human metadata.

**Compression & content type**

* Use `application/gzip` and `.tar.gz` or `.jsonl.gz`. Choose consistent encoding across exports.

---

## `manifest.json` (required)

A top-level signed manifest describing the export. Example fields:

```json
{
  "service": "finance",
  "env": "prod",
  "export_id": "export-20251117-001",
  "from_ts": "2025-11-01T00:00:00Z",
  "to_ts": "2025-11-30T23:59:59Z",
  "num_ledger_rows": 12345,
  "num_proofs": 1,
  "pii_included": false,
  "pii_policy_version": "2025-11-17-v1",
  "signer_kid": "finance-signer-v1",
  "signature": "<base64-of-canonical-manifest>",
  "signature_alg": "rsa-sha256",
  "created_at": "2025-11-30T23:59:59Z",
  "tool_version": "finance-exporter-v1.2.3"
}
```

**Signing the manifest**

* Sign the canonicalized manifest (byte-for-byte canonicalization is required). Use KMS or signing proxy. Include `signer_kid` and `signature`. If using a signing proxy, include its `signer_kid` and a reference to the signer’s public key in the Kernel verifier registry.

**Canonicalization**

* Use the same canonicalization rules as Kernel/Journals so that proof verification chains are consistent. Document canonicalization version and include it in manifest (`canonical_version` if needed).

---

## IAM & access controls

**Principles**

* Least privilege: only the Finance export job and auditor service accounts can put/get objects from `illuvrse-audit-archive-*`.
* No developer accounts should have write access to production audit buckets.

**Suggested IAM roles**

* `finance-exporter-role` — PutObject+PutObjectTagging + PutObjectRetention on `illuvrse-audit-archive-*` prefix; no DeleteObject.
* `auditor-read-role` — GetObject/ListObject for auditor prefixes.
* `infra-admin` — limited admin role for emergency operations, highly restricted.

**Bucket policy sample (high level)**

* Allow `finance-exporter-role` PutObject/PutObjectRetention on `finance/*` prefix.
* Deny any `s3:DeleteObject` actions unless from `infra-admin` with MFA and documented approval (depends on Governance vs Compliance mode).

---

## Encryption & integrity

* **At rest:** Use SSE-KMS with a KMS key dedicated to audit archives (separate from operational keys). Use KMS key policies to restrict decrypt to auditors and security.
* **In transit:** Use HTTPS and enforce TLS on S3 endpoints or VPC endpoints.
* **Integrity:** Upload checksums (`Content-MD5`) or include per-file hash in the manifest. Prefer using signed manifest + signature to ensure end-to-end integrity.

---

## Upload lifecycle & verification

1. **Produce export** into temporary location (e.g., `audit-temp` or local filesystem).
2. **Canonicalize & sign manifest** with KMS/signing-proxy.
3. **Upload** artifact(s) to `audit-temp` or direct to `audit-archive` with `PutObjectRetention` set to the retention TTL. Use `x-amz-object-lock-mode` and `x-amz-object-lock-retain-until-date` headers (for S3 API).
4. **Verify upload**: after upload, the exporter runs `aws s3api head-object` to confirm lock & metadata.
5. **Run audit-verify** on the exported proofs/manifest (local verification). If verification fails, do not mark export as complete — escalate and remediate.
6. **Record export audit event**: emit an AuditEvent linking `export_id`, `s3_path`, signer_kid, and verification result.

---

## Access & retrieval for auditors

* Auditors access exported bundles via `auditor-read-role` or through a documented retrieval pipeline (signed URLs generated by infra with short TTL).
* Provide `finance/tools/verify_audit_bundle.sh` that automates:

  * Downloading the export
  * Verifying manifest signature with `signer_kid` public key
  * Running `kernel/tools/audit-verify.js` on ledger rows

---

## Retention & retention policy management

* Retention duration determined by Legal/Compliance (e.g., 7 years). Set default retention in bucket policy or at object level on upload.
* Document retention changes and maintain audit trail for retention policy updates.

---

## Deletion / purge rules

* **No deletions** from `audit-archive-*` until retention expiry unless authorized under a legal process. If permitted, removal must be done through an auditable, authorized process (Security + Legal signoff).

---

## Monitoring & alerting

Export process must emit metrics & logs:

* `finance.audit_export_attempts_total`
* `finance.audit_export_success_total`
* `finance.audit_export_failure_total`
* `finance.audit_object_lock_misconfig_total` (raised if Object Lock not present)
* Alerts: export failure rates, object-lock not enabled, inability to write retention metadata, verification failures.

---

## DR & replay

* Keep an alternate copy or cross-region replication for disaster recovery. Replication target must also have Object Lock enabled and proper IAM.
* DR drill: monthly or quarterly, restore a sample export to test cluster and run `audit-verify` to validate reproducibility.

---

## Operational runbook (step-by-step)

**To produce an export:**

1. Run the export job with explicit params (`from_ts`, `to_ts`, `pii_included`).
2. Job creates canonicalized `ledger_rows.jsonl.gz`, `proof.json` and `manifest.json`.
3. Sign manifest via KMS/signing-proxy.
4. Upload files to `s3://illuvrse-audit-archive-prod/finance/<YYYY/MM/DD>/export-...tar.gz` with `x-amz-object-lock-mode` and retention date header.
5. Run head-object to validate retention.
6. Run `audit-verify` locally against uploaded ledger rows & proof.
7. Emit `audit_export.completed` AuditEvent (include s3 path + verification result).
8. Notify auditors (email/Slack) with retrieval instructions.

**If verification fails:**

1. Do not mark export as completed. Log failure, retain temp artifacts, and escalate to Security & Finance lead.
2. Investigate canonicalization mismatch, re-run signer proof generation, and correct exporter until verification passes.

---

## Emergency / corrective procedures

* If bucket lacks Object Lock or bucket policy misconfigured for an existing export, escalate to Security & SRE immediately. Do not attempt to delete/overwrite objects (this may violate compliance).
* If a signed manifest appears invalid, run parity tests and canonicalization vectors to detect mismatch; generate a corrected export if needed. Document all steps and produce an RCA.

---

## References & helpers

* `kernel/tools/audit-verify.js` — canonical audit verification tool. Use to verify audit chains after export. 
* Example signer registry: `kernel/tools/signers.json`. Use public key(s) referenced by `manifest.signer_kid` for verification. 

---

**Sign-off:** Security & Compliance must approve this export policy and associated retention durations before the first production export occurs.

