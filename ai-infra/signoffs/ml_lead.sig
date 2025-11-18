# AI & Infrastructure — ML Lead Signoff
# File: ai-infra/signoffs/ml_lead.sig
#
# Records the ML Lead's approval for AI & Infrastructure acceptance criteria
# as described in ai-infra/deployment.md and related artifacts.
#
# Replace the SIGNATURE placeholder with a real cryptographic signature
# (GPG ASCII-armored, KMS-signed base64 proof, or a pointer to an audit event
# containing the signed approval).
#
signer_name: "<ML lead full name>"
signer_role: "ML Lead"
module: "ai-infra"
approved_at: "<YYYY-MM-DDTHH:MM:SSZ>"  # ISO8601 UTC timestamp, e.g. 2025-11-19T14:00:00Z

acceptance_statement: |
  I, the ML Lead, have reviewed AI & Infrastructure requirements, including:
  - reproducible training instrumentation (codeRef, container digest, dataset checksums, seeds),
  - model registry schema and artifact provenance,
  - manifest signing and promotion gating semantics,
  - canary rollout strategy and automated rollback behavior,
  - drift detection pipeline and retrain suggestion mechanics,
  - verification tooling for reproducibility and manifest signature validation,
  - CI reproducibility guards and runbooks for training/serving.
  I confirm the AI & Infrastructure module meets the ML acceptance criteria for staging/production
  readiness subject to any open items listed below.

open_issues_and_notes: |
  - (optional) Outstanding ML caveats, validations, or required followups:
    1) ...
    2) ...

# SIGNATURE: Replace the block below with an actual cryptographic signature or audit-event reference.
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

