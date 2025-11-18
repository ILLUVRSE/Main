# Reasoning Graph — Security Engineer Signoff
# File: reasoning-graph/signoffs/security_engineer.sig
#
# Records the Security Engineer's approval for the Reasoning Graph module
# acceptance criteria as described in reasoning-graph/acceptance-criteria.md,
# reasoning-graph/api.md, reasoning-graph/deployment.md and PII_POLICY.md.
#
# Replace the SIGNATURE placeholder with a real cryptographic signature
# (GPG ASCII-armored, KMS-signed base64, or a pointer to an audit event with proof).
#
signer_name: "<security engineer full name>"
signer_role: "Security Engineer"
module: "reasoning-graph"
approved_at: "<YYYY-MM-DDTHH:MM:SSZ>"  # ISO8601 UTC timestamp, e.g. 2025-11-18T20:00:00Z

acceptance_statement: |
  I, the Security Engineer, have reviewed Reasoning Graph's:
  - Kernel-authenticated write model (mTLS or Kernel-signed tokens) and enforcement,
  - snapshot canonicalization parity requirements and parity tests,
  - snapshot signing & signer lifecycle and verifySnapshot tooling,
  - audit linkage of nodes/edges/snapshots to Kernel audit events,
  - PII classification and redaction pipeline (reasoning-graph/docs/PII_POLICY.md),
  - RBAC and access controls for read:trace / read:pii capabilities,
  - storage/export to object-lock S3 for snapshots and recovery/DR runbooks,
  - CI guardrails that ensure canonical parity tests and secrets scanning.
  I confirm that the Reasoning Graph module meets the minimum security requirements
  for staging/production, subject to any open items listed below.

open_issues_and_notes: |
  - (optional) Outstanding security caveats, mitigations, or required followups:
    1) ...
    2) ...

# SIGNATURE: Replace with a cryptographic signature or audit-event reference.
# Examples:
#  - GPG ASCII-armored signature:
#    -----BEGIN PGP SIGNATURE-----
#    ...
#    -----END PGP SIGNATURE-----
#
#  - KMS-signed base64 assertion including signer_kid and timestamp
#  - Audit event reference: audit_event_ref: "audit-000123"
#
SIGNATURE: |
  <PASTE YOUR SIGNATURE OR SIGNATURE REFERENCE HERE>

# End of file

