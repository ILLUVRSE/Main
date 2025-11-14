# Multisig Workflow

1. FinanceLead initiates payout via API. Payout stored with status `pending_approval`.
2. Notification service posts to Slack channel `#finance-approvals` including payout hash and amount.
3. Approvers retrieve payload hash using `finance/service/src/exports/canonical_exporter.ts --payout <id>`.
4. Each approver signs hash with hardware key via signing proxy client (CLI uses `config/signing_proxy_config.yaml`).
5. Approver submits signature to `POST /finance/payout/{id}/approvals`.
6. `payoutService` evaluates quorum per `security/multisig_policy.md`. Once satisfied, service calls payout provider adapter.
7. Proof service bundles payout approval events into next ledger proof.
