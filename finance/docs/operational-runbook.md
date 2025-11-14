# Finance Service Operational Runbook

This runbook captures day-2 procedures for Finance operations.

## 1. Signed Proof Generation
1. Trigger export via `npm run finance:export -- <from> <to>` (requires `DATABASE_URL`, `KMS_KEY_ID`, `S3_AUDIT_BUCKET`).
2. Monitor service logs for `exports.duration_ms` metric confirming completion and note the emitted `proofId`.
3. Download the generated `proof_package.json` from `s3://$S3_AUDIT_BUCKET/proofs/...` and validate signatures with `node finance/exports/audit_verifier_cli.ts <proof_package>`.
4. Retain the reconciliation report that ships with the proof bundle; Object Lock + SSE-KMS are applied automatically by the exporter.

## 2. Reconciliation Drill
1. Pull the latest reconciliation report from S3 via `aws s3 cp s3://$S3_AUDIT_BUCKET/proofs/.../reconciliation_report.json -` (reports are stored alongside proofs).
2. If a fresh report is required, run `npm run finance:export -- <from> <to>` which regenerates both the proof and reconciliation data against live Stripe/local payout sandboxes.
3. Resolve discrepancies by posting adjusting journal entries via `POST /finance/journal` and rerun the exporter to confirm parity.
4. Document drill outcomes in `finance/acceptance-checklist.md` and attach the latest reconciliation report URL.

## 3. Incident Response
- **Ledger imbalance alert**: verify last batch ID, re-run reconciliation, check for partially applied transactions, roll forward using `ledgerService.repairBatch` helper.
- **Failed proof signing**: inspect `signingProxy` health, verify KMS key grants, reissue signing request after ensuring quorum.
- **Payout stuck in pending**: review approvals via `GET /payout/{id}`, confirm audit events, re-trigger provider settlement.

## 4. Operator Playbook
- Deployments must follow `cd/deploy-pipeline.yml`; no direct manual pushes.
- Rotate database credentials quarterly; update `server/config.ts` to pick up new secret references.
- Store backups per `backups/backup_policy.md` and execute restore drill monthly following `backups/restore_drill.md`.
- For any manual data fix, require paired operator review and attach proof package covering affected interval.

## 5. Contacts
- Finance on-call: finance-oncall@illuvrse.com
- Security on-call: security-oncall@illuvrse.com
- SuperAdmin: ryan@illuvrse.com
