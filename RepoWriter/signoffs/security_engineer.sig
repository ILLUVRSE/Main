# RepoWriter — Security Engineer Signoff
# File: RepoWriter/signoffs/security_engineer.sig
#
# Records the Security Engineer's approval for the RepoWriter module acceptance
# criteria as described in RepoWriter/server/acceptance-criteria.md and
# RepoWriter/security-review.md.
#
# Replace the SIGNATURE placeholder with a real cryptographic signature
# (GPG ASCII-armored, KMS-signed base64 proof, or a pointer to an audit event
# containing the signed approval).
#
signer_name: "<security engineer full name>"
signer_role: "Security Engineer"
module: "RepoWriter"
approved_at: "<YYYY-MM-DDTHH:MM:SSZ>"  # ISO8601 UTC timestamp, e.g. 2025-11-20T09:00:00Z

acceptance_statement: |
  I, the Security Engineer, have reviewed RepoWriter's:
  - commit automation behavior and proof that RepoWriter never signs manifests itself,
  - server-side behavior that commits Kernel-signed manifests and attaches manifestSignatureId,
  - audit emission for commit actions and repository changes (append-only AuditEvents),
  - CI guardrails to prevent private keys/PEM files from being pushed,
  - secrets handling and usage of signing proxies / KMS where required,
  - security-review findings and remediation items in RepoWriter/security-review.md.
  I confirm that RepoWriter meets the minimum security requirements for staging/production,
  subject to any open items listed below.

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

