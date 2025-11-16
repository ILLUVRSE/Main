# RepoWriter — Acceptance & Sign-Off (final gate)

This document defines the final acceptance gate for RepoWriter and the exact sign-off process.  
**Required final signers:** Security Engineer, Finance Lead, Ryan (SuperAdmin). All three must sign before RepoWriter is promoted to production.

---

## Purpose
Collect explicit, timestamped approvals that the product:
- Meets the Final Acceptance Criteria,
- Has completed Security review & remediation,
- Has an operable production deployment and runbook,
- Has completed acceptance tests (smoke + e2e), and
- Has Finance agreement on audit/ledger implications.

---

## Required artifacts to attach before sign-off
Ensure the following artifacts are present and verified in the release ticket / PR / release folder:

1. `repowriter-ci` workflow: green build + unit test results. (See `.github/workflows/repowriter-ci.yml`)
2. Signing/KMS: `SIGNING_PROXY_URL` configured in staging/prod; signing-proxy smoke test logs showing `{ signature_b64, signer_id }`. (See `RepoWriter/docs/signing.md`)
3. Startup checks: Evidence that `runStartupChecks()` passes in staging/prod (logs or output).
4. Rollback tests: integration logs demonstrating apply → rollback restores repo state.
5. Audit events: examples of AuditEvents emitted for an apply/commit; audit stored in append-only store.
6. Allowlist: `repowriter_allowlist.json` enforced (tests and example rejection of forbidden path).
7. Production runbook: `RepoWriter/docs/PRODUCTION.md` reviewed and accepted.
8. Monitoring/alerts: Prometheus rules deployed (e.g., `repowriter-alerts.yaml`) and a brief test showing alert firing for a simulated failure.
9. Secrets & KMS: proof that secrets are in secret manager and not in git (Vault policy or secret manifest).
10. Any remediations for Security review are closed or have an approved mitigation plan.

Attach links or short evidence notes in the signoff files below.

---

## How to sign off (process)

1. **Prepare evidence** — add the links/attachments above to the release ticket or to a central folder and ensure each item is accessible to signers.
2. **Security Engineer** runs `RepoWriter/security-review.md`, completes the checklist, and then adds a signed artifact `RepoWriter/signoffs/security_engineer.sig` (see template).
3. **Finance Lead** reviews audit/ledger integrations and confirms finance acceptance by adding `RepoWriter/signoffs/finance_lead.sig`.
4. **Ryan (SuperAdmin)** performs final review and signs `RepoWriter/signoffs/ryan.sig`.
5. Once all three signatures are present, the release can be promoted to production.

---

## Signoff template (copy into each signer file)

Each signer file should include:

- Name:
- Role:
- Date (ISO 8601):
- Decision: APPROVE / CONDITIONAL_APPROVAL / REJECT
- Evidence (links to artifacts and test logs):
- Notes / Conditions (if CONDITIONAL_APPROVAL, list required remediation and ETA):

Example:

```

Name: Jane Security
Role: Security Engineer
Date: 2025-11-16T15:30:00Z
Decision: APPROVE
Evidence:

* security-review.md (link to review output)
* audit logs: s3://audit-bucket/repowriter/...
  Notes: None.

```

Place the completed file in `RepoWriter/signoffs/<role>.sig`.

---

## Post-signoff actions
- Document signoff in the release ticket and update the FINAL_COMPLETION_BLUEPRINT for the release.
- If any signoff is CONDITIONAL, do not promote the release until conditions are met and signers update their `.sig` files.

---

## Final approver
- Ryan (SuperAdmin) must be present as the last approver for production promotion.

```

---

Then create these three signer template files (one per signer). Save each file exactly.

File 1:

`RepoWriter/signoffs/security_engineer.sig`

Contents:

```
Name: <Security Engineer full name>
Role: Security Engineer
Date: <YYYY-MM-DDTHH:MM:SSZ>
Decision: <APPROVE | CONDITIONAL_APPROVAL | REJECT>
Evidence:
  - security-review.md: <link or path to evidence>
  - audit logs: <link>
Notes:
  - <if CONDITIONAL_APPROVAL, list remediation and ETA>
```

---

File 2:

`RepoWriter/signoffs/finance_lead.sig`

Contents:

```
Name: <Finance Lead full name>
Role: Finance Lead
Date: <YYYY-MM-DDTHH:MM:SSZ>
Decision: <APPROVE | CONDITIONAL_APPROVAL | REJECT>
Evidence:
  - finance acceptance checklist: <link or path>
  - ledger/audit sample: <link>
Notes:
  - <if CONDITIONAL_APPROVAL, list remediation and ETA>
```

---

File 3:

`RepoWriter/signoffs/ryan.sig`

Contents:

```
Name: Ryan Lueckenotte
Role: SuperAdmin (Ryan)
Date: <YYYY-MM-DDTHH:MM:SSZ>
Decision: <APPROVE | CONDITIONAL_APPROVAL | REJECT>
Evidence:
  - release ticket: <link>
  - CI run: <link>
  - final smoke test logs: <link>
Notes:
  - <if CONDITIONAL_APPROVAL, list remediation and ETA>
```
