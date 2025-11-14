# Finance Service Operational Runbook

This runbook captures day-2 procedures for Finance operations.

## 1. Signed Proof Generation
1. Trigger export via `finance/acceptance-tests/run_acceptance.sh proof` or CI pipeline.
2. Monitor `proofService` logs for `manifestHash` and `proofId`.
3. Validate `signature.json` contains quorum defined in `security/multisig_policy.md`.
4. Upload package to auditor S3 bucket with Object Lock enabled.

## 2. Reconciliation Drill
1. Pull latest ledger snapshot by running `finance/service/src/services/reconciliationService.ts` CLI entry (`npm run finance:reconcile`).
2. Compare ledger balances to Stripe and payout provider statements.
3. Resolve discrepancies by posting adjusting journal entries via `POST /finance/journal`.
4. Document drill outcome in `acceptance-checklist.md` and archive reconciliation report.

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
