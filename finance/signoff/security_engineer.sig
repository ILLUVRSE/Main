# Finance — Security Engineer Signoff
# File: finance/signoffs/security_engineer.sig
#
# Records the Security Engineer's approval for the Finance module acceptance
# criteria as described in finance/acceptance-criteria.md, finance/api.md, and
# finance/deployment.md.
#
# Replace the SIGNATURE placeholder with a real cryptographic signature
# (GPG ASCII-armored, KMS-signed base64 proof, or a pointer to an audit event
# containing the signed approval).
#
signer_name: "<security engineer full name>"
signer_role: "Security Engineer"
module: "finance"
approved_at: "<YYYY-MM-DDTHH:MM:SSZ>"  # ISO8601 UTC timestamp, e.g. 2025-11-19T18:00:00Z

acceptance_statement: |
  I, the Security Engineer, have reviewed Finance's:
  - double-entry ledger implementation and balancing invariants,
  - KMS/HSM usage for signed ledger proofs and key lifecycle,
  - isolation and governance model for finance workloads (mTLS, least-privilege IAM),
  - reconciliation endpoints and auditor export format and protections,
  - audit linkage to Kernel audit bus, and ledger proof verification tools,
  - PCI / payment-provider integration requirements (where applicable) and related controls,
  - CI/CD guardrails (REQUIRE_KMS enforcement) and secrets handling.
  I confirm that Finance meets the minimum security requirements for staging/production
  acceptance, subject to the open items listed below.

open_issues_and_notes: |
  - (optional) Outstanding security caveats, mitigations, or required followups:
    1) ...
    2) ...

# SIGNATURE: Replace the block below with an actual cryptographic signature or a reference.
# Examples:
#  - GPG ASCII-armored signature:
#    -----BEGIN PGP SIGNATURE-----
#    ...
#    -----END PGP SIGNATURE-----
#
#  - Base64 KMS-signed assertion including signer_kid and ts
#  - Audit event reference: audit_event_ref: "audit-000123"
#
SIGNATURE: |
  <PASTE YOUR SIGNATURE OR SIGNATURE REFERENCE HERE>

# End of file

