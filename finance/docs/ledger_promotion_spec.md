# Finance Ledger & Promotion Spec

## Ledger Schema

Double-entry accounting is enforced. Every transaction must have balanced debits and credits.

### Journal Entry

```json
{
  "journalId": "uuid",
  "timestamp": "ISO-8601",
  "currency": "USD",
  "lines": [
    { "accountId": "Assets:Cash", "direction": "debit", "amount": 100 },
    { "accountId": "Revenue:Sales", "direction": "credit", "amount": 100 }
  ]
}
```

## Reconciliation

Reconciliation involves verifying that:
1. `sum(debits) == sum(credits)` for every journal entry.
2. Ledger entries are linked to valid Promotion IDs and Audit IDs.

## Promotion Integration

When a promotion is requested:
1. `eval-engine` requests allocation.
2. `finance` creates a pending reservation (ledger entry).
3. If confirmed, `finance` posts the final transaction.

## Audit

All finance actions are audited via `AuditService` and linked to the Kernel Audit Bus.
