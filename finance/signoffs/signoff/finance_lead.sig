# Finance — Finance Lead Signoff
# File: finance/signoffs/finance_lead.sig
#
# Records the Finance Lead's approval for the Finance module acceptance
# criteria as described in finance/acceptance-criteria.md, finance/api.md, and
# finance/deployment.md.
#
# Replace the SIGNATURE placeholder with a real cryptographic signature
# (GPG ASCII-armored, KMS-signed base64 proof, or a pointer to an audit event
# containing the signed approval).
#
signer_name: "<finance lead full name>"
signer_role: "Finance Lead"
module: "finance"
approved_at: "<YYYY-MM-DDTHH:MM:SSZ>"  # ISO8601 UTC timestamp, e.g. 2025-11-19T19:00:00Z

acceptance_statement: |
  I, the Finance Lead, have reviewed the Finance module's:
  - double-entry ledger correctness and idempotent posting semantics,
  - signed ledger proof generation and verification model,
  - isolation and governance controls for finance workloads (mTLS, least-privilege IAM),
  - reconciliation endpoints and auditor export bundles,
  - settlement flows and integration touchpoints with Marketplace and Resource Allocator,
  - operational runbooks for reconciliation, DR and auditor requests,
  - CI/CD guardrails and secrets handling relevant to finance operations.
  I confirm that Finance meets the functional and operational requirements for staging/production
  acceptance, subject to any open items listed below.

open_issues_and_notes: |
  - (optional) Outstanding finance caveats, reconciliations, or required followups:
    1) ...
    2) ...

# SIGNATURE: Replace the block below with an actual cryptographic signature or a reference.
# Examples:
#  - GPG ASCII-armored signature:
#    -----BEGIN PGP SIGNATURE-----
#    ...
#    -----END PGP SIGNATURE-----
#
#  - Base64 KMS-signed assertion including signer_kid and timestamp
#  - Audit event reference: audit_event_ref: "audit-000123"
#
SIGNATURE: |
  <PASTE YOUR SIGNATURE OR SIGNATURE REFERENCE HERE>

# End of file

