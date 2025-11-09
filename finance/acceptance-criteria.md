# Finance — Acceptance Criteria

Finance must provide a provable double-entry ledger and signed proofs for auditors.

## # 1) Double entry integrity
- All journal entries balance: sum(debits)==sum(credits). Automated checks exist.

## # 2) Payments & payouts
- Integrate with Stripe for payments and with a payout provider for settlements.
- Payout flows require multisig for high-value transactions.

## # 3) Signed proofs
- Ledger ranges export as canonicalized signed packages.

## # 4) Reconciliation & exports
- Export formats for auditors and reconciliation tooling exist.

## # Test
- Post journal entries, run reconcile, and verify signed proof matches ledger state.

