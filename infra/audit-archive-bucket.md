# Audit Archive S3 Bucket — Object-Lock & DR Runbook

Memory Layer, Marketplace, and Finance emit immutable audit artifacts (manifests, delivery packages, ledger proofs). All of them write to a shared `audit-archive` S3 bucket configured with object-lock, lifecycle rules, and cross-region replication. This document captures the canonical configuration and operational tests.

---

## Bucket provisioning

| Property | Value |
| --- | --- |
| Bucket name (per env) | `illuvrse-audit-archive-${ENV}` |
| Region | `us-east-1` primary, replicate to `us-west-2` |
| Encryption | `SSE-KMS` with key alias `alias/audit-archive-${ENV}` |
| Object Lock | **Enabled in compliance mode**, minimum retention 400 days |
| Versioning | Enabled (required for object-lock + GLACIER tiering) |
| Access logging | Enabled; target bucket `illuvrse-audit-logs` |
| Lifecycle | Transition non-legal-hold objects to Glacier Instant Retrieval after 30 days, Deep Archive after 365 days; expire incomplete multipart uploads after 7 days |

### CLI sketch

```bash
aws s3api create-bucket \
  --bucket illuvrse-audit-archive-prod \
  --object-lock-enabled-for-bucket \
  --region us-east-1

aws s3api put-bucket-versioning \
  --bucket illuvrse-audit-archive-prod \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket illuvrse-audit-archive-prod \
  --server-side-encryption-configuration '{
    "Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms","KMSMasterKeyID":"alias/audit-archive-prod"}}]}'

aws s3api put-object-lock-configuration \
  --bucket illuvrse-audit-archive-prod \
  --object-lock-configuration '{
    "ObjectLockEnabled":"Enabled",
    "Rule":{"DefaultRetention":{"Mode":"COMPLIANCE","Days":400}}}'
```

---

## IAM roles

| Principal | Permissions | Notes |
| --- | --- | --- |
| `arn:aws:iam::<acct>:role/memory-layer-writer` | `s3:PutObject`, `s3:PutObjectRetention`, `s3:PutObjectLegalHold` | Can write and manage legal holds on their own keys; cannot delete versions. |
| `...:role/marketplace-audit-writer` | `s3:PutObject`, `s3:GetObject`, `s3:PutObjectLegalHold` | Used by Marketplace delivery workers. |
| `...:role/finance-proof-writer` | Same as above. |
| `...:role/audit-reader` | `s3:GetObjectVersion`, `s3:GetObjectRetention` | Read-only access for auditors and DR tooling. |
| `...:role/audit-admin` | `s3:GetObject*`, `s3:PutObjectLegalHold`, `s3:GetBucketObjectLockConfiguration` | Small break-glass role; requires Security approval via IAM permission boundary. |

Bucket policy must explicitly deny `s3:DeleteObject*` unless `aws:PrincipalArn` equals the audit-admin role **and** the request includes `x-amz-mfa`. This enforces MFA-delete semantics even though object-lock already blocks removal.

---

## Replication & lifecycle

1. Enable cross-region replication (CRR) to `illuvrse-audit-archive-${ENV}-secondary` with a different KMS key.
2. Replication role: `audit-archive-replication` with permissions to read versions + lock metadata and write to secondary bucket.
3. Lifecycle rules:
   - Transition to Glacier Instant Retrieval (`Days=30`) if `tag:legal_hold=false`.
   - Transition to Deep Archive (`Days=365`) for the same objects.
   - Leave legal-hold objects in standard storage until released.
   - Expire noncurrent versions older than 5 years (compliance requirement) after review.

---

## Restore & checksum drill (quarterly)

1. Select a random object version older than 90 days in primary bucket (tag `dr_sample=true`).
2. Initiate restore from Deep Archive if necessary.
3. Download the object to the DR staging environment, compute SHA-256, and compare to the recorded hash in the originating system (Memory Layer audit log or Marketplace delivery manifest).
4. Replay the artifact into a staging Memory Layer instance:
   ```bash
   memoryctl audit replay \
     --from-s3 s3://illuvrse-audit-archive-prod/<key> \
     --database-url "$MEMORY_LAYER_STAGING_DB"
   ```
5. Validate:
   - Replayed audit events produce identical hash chain.
   - Associated artifacts reappear via `/memory/audit/:id`.
   - For Marketplace, re-run delivery verification using the restored payload.
6. Record the drill outcome, checksum, and timestamp in `drill_results` table (or shared GRC log).

If any step fails, treat it as a P1 incident until resolved; object-lock settings should prevent data loss, so failures usually indicate tooling regressions.

---

## Integration expectations

- **Memory Layer**: writes every audit event + artifact manifest to this bucket (see `memory-layer/deployment.md`). Nightly job also exports a manifest list to Postgres for quick diffing.
- **Marketplace**: pushes delivery audit bundles and license packages with `ObjectLockMode=COMPLIANCE`. Delivery runbook references this bucket for DR.
- **Finance**: ledger proofs and payout manifests land here; Finance DR drills reuse the same restore process.

All services must treat the bucket as write-once; updates happen as new object versions with new retention windows.
