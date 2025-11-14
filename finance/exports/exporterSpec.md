# Reconciliation Exporter Specification

The canonical exporter (`canonical_exporter.ts`) produces datasets required by Finance and auditors:

- `reconciliation_report.json` — summary of ledger vs. provider balances with mismatches.
- `proof_package.json` — embeds the proof defined in `proof-package-spec.md`.
- `audit_log.jsonl` — high-risk audit events for the interval.

## Inputs
- `from`, `to` timestamps.
- Signing approvals (list of `{ role, signature }`).
- Output format (`json` or `tar`).

## Process
1. Fetch ledger slice via repository.
2. Run `ReconciliationService` to compare against Stripe and payout provider.
3. Build proof via `ProofService`.
4. Emit deterministic files. `audit_log.jsonl` sorted by `createdAt`.

## Outputs
Example layout:
```
proof_package.json
reconciliation_report.json
audit_log.jsonl
```

Each field is documented inline within the exporter implementation for traceability.
