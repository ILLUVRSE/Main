# Restore Drill Instructions

1. Provision isolated VPC using `infra/terraform` with `drill=true`.
2. Restore latest snapshot via `run_restore_drill.sh` script (see nested directory).
3. Run `finance/exports/audit_verifier_cli.ts` against restored proof package.
4. Document findings and attach to `acceptance-checklist.md`.
