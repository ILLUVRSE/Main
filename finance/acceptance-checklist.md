# Finance Acceptance Checklist

- [ ] Double-entry ledger posts sampled entries without imbalance (see `finance/test/unit/journal.test.ts`).
- [ ] Stripe + payout reconciliation completed and report stored.
- [ ] Signed proof generated and verified via `audit_verifier_cli.ts`.
- [ ] Multisig payout executed with evidence of FinanceLead + SecurityEngineer approvals.
- [ ] Backup restore drill executed this month with log attached.
- [ ] Acceptance tests (`finance/acceptance-tests/run_acceptance.sh`) pass in CI.
