# Finance — Specification

## Models
- `journal_entry`, `account`, `invoice`, `payout`

## API
### `POST /finance/journal`
- Accept journal entries and validate balancing.

### `POST /finance/payout`
- Payout flow requiring approval steps (multisig).

### `GET /finance/proof?from=...&to=...`
- Return signed proof package.

## Auditing
- All high-risk actions create audit events.

