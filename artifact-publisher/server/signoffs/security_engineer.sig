# ArtifactPublisher (server) — Security Engineer Signoff
# File: artifact-publisher/server/signoffs/security_engineer.sig
#
# Records the Security Engineer's approval for the ArtifactPublisher server
# acceptance criteria as described in artifact-publisher/server/acceptance-criteria.md
# and artifact-publisher/server/deployment.md.
#
# Replace the SIGNATURE placeholder with a real cryptographic signature
# (GPG ASCII-armored, KMS-signed base64 proof, or a pointer to an audit event
# containing the signed approval).
#
signer_name: "<security engineer full name>"
signer_role: "Security Engineer"
module: "artifact-publisher/server"
approved_at: "<YYYY-MM-DDTHH:MM:SSZ>"  # ISO8601 UTC timestamp, e.g. 2025-11-20T11:00:00Z

acceptance_statement: |
  I, the Security Engineer, have reviewed ArtifactPublisher server's:
  - encrypted delivery model and encryption-at-rest/in-transit controls,
  - linkage of delivery proofs to Kernel manifestSignatureId and ledger proofs,
  - audit emission for delivery events and integration with the audit pipeline,
  - KMS/HSM usage for encryption/signing of delivery proofs and keys lifecycle,
  - secrets handling (no private keys in repo/images; use Vault/secret manager),
  - operational runbooks for delivery failure, replay, and DR,
  - CI guardrails (REQUIRE_KMS enforcement) and secrets scanning.
  I confirm that the ArtifactPublisher server meets the minimum security requirements
  for staging/production acceptance, subject to any open items listed below.

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

