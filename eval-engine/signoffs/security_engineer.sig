# Eval Engine & Resource Allocator — Security Engineer Signoff
# File: eval-engine/signoffs/security_engineer.sig
#
# Records the Security Engineer's approval for the Eval Engine & Resource Allocator
# acceptance criteria as described in eval-engine/acceptance-criteria.md,
# eval-engine/api.md, and eval-engine/deployment.md.
#
# Replace the SIGNATURE placeholder with a real cryptographic signature
# (GPG ASCII-armored, KMS-signed base64, or an audit-event reference with proof).
#
signer_name: "<security engineer full name>"
signer_role: "Security Engineer"
module: "eval-engine"
approved_at: "<YYYY-MM-DDTHH:MM:SSZ>"  # e.g., 2025-11-19T10:00:00Z

acceptance_statement: |
  I, the Security Engineer, have reviewed the Eval Engine & Resource Allocator
  documentation, API contract, deployment/runbooks, audit signing & canonicalization,
  SentinelNet policy integration, Finance settlement flows, RBAC/mTLS enforcement,
  CI guardrails (REQUIRE_KMS) and the acceptance tests. I confirm that, to the
  best of my knowledge, the Eval Engine and Resource Allocator meet the minimum
  security requirements for staging/production acceptance, subject to the open
  items noted below.

open_issues_and_notes: |
  - (optional) Outstanding security caveats or mitigations:
    1) ...
    2) ...

# SIGNATURE: Replace the block below with an actual cryptographic signature or a reference.
# Examples:
#  - GPG ASCII-armored signature:
#    -----BEGIN PGP SIGNATURE-----
#    ...
#    -----END PGP SIGNATURE-----
#
#  - Base64 KMS-signed proof including signer_kid and ts
#  - Audit event reference: audit_event_ref: "audit-000123"
#
SIGNATURE: |
  <PASTE YOUR SIGNATURE OR SIGNATURE REFERENCE HERE>

# End of file

