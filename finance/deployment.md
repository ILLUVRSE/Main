# Finance — Deployment

## Isolation
- Finance must run in isolated infra (private subnets, restricted access).
- Database encryption at rest, KMS usage for signing.

## Signing proxy
- All ledger proofs signed by an HSM/KMS; signing proxy enforces policy.

## Backups
- DB backups and export tooling; auditor restore drill mandatory.

