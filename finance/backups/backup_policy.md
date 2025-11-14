# Backup Policy

- Full logical backup nightly at 02:00 UTC using pg_dump, encrypted with KMS key `alias/finance-backup`.
- Binary WAL archiving continuous with 7-day retention.
- Proof packages stored in S3 with Object Lock (WORM) for 7 years.
- Quarterly backup restore verification documented in `restore_drill.md`.
