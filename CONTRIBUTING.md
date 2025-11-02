# Contributing to ILLUVRSE — Main Repo

Thanks for helping build ILLUVRSE. This repo follows strict, auditable processes: one file at a time, clear ownership, and signed approvals for critical changes. Follow these rules — they matter.

---

## One-file-at-a-time workflow
1. **Single-file changes** — Add or change *one file* per iteration. The reviewer (me) will give the next file after you save and confirm by replying `done`.  
2. **Local test first** — Implement and test locally before committing. Don’t push half-baked sequences of files.  
3. **Commit atomic changes** — Keep commits small and focused (one logical change per commit).

---

## Branching & PRs
- Branch naming: `feature/<module>-<short-desc>` or `fix/<module>-<short-desc>`.  
- Open a PR against `main` when the file is added and local checks pass. Title should be concise: `Add <module>/<file> — short description`.  
- Include the acceptance-criteria file for the module in the PR description if present.

---

## Commit message format
Use a single-line subject and optionally a short body. Examples:

kernel: add kernel-api-spec.md — purpose & endpoints

Add the initial kernel API spec. This is the first contract file and
includes minimal endpoints and canonical models.


Prefix with the module name for discoverability (e.g., `marketplace:`, `finance:`).

---

## Reviews & approvals
- At least **one** code review is required for non-trivial files. Security-, Finance-, or Legal-sensitive files require Security/Finance/Legal review and sign-off.  
- The module's `acceptance-criteria.md` must be satisfied before "final" sign-off. Ryan (SuperAdmin) is the final approver for core modules.

---

## Tests & validation
- Add unit/integration tests where applicable. Tests must run locally.  
- Run linters and schema validators (where present) before opening a PR.  
- For API/OpenAPI files, validate with an OpenAPI linter/tool. For canonical JSON rules, include tests or a small validation script.

---

## Secrets & sensitive data
- **Never** commit secrets, keys, or PII. Use Vault / KMS. Files that look like secrets will be rejected.  
- .gitignore at repo root must include `keys.json`, `db.json`, `.env*`, and any runtime secret files.

---

## Audit & signing requirements
- All critical manifests or governance files must include a `manifestSignatureId` and link to the Kernel audit event when applied.  
- High-risk changes require multisig per the multisig workflow. The PR must reference the upgrade manifest or multisig ticket.

---

## Formatting & style
- Markdown for docs. Keep prose clear and short. Use bullets for lists.  
- API specs use YAML (OpenAPI). Data models use JSON examples where appropriate.  
- Follow existing files’ conventions: camelCase for API fields, snake_case for DB hints.

---

## CI / checks
- Ensure CI passes (lint, tests, policy checks). If CI is not present for the module, run the local linter/test listed in the module README.

---

## Emergency / break-glass
- For urgent changes (security/keys), follow the multisig break-glass procedure in `multisig-workflow.md`. Record the emergency action as an audit event and file a post-incident report.

---

## Questions & help
If you’re unsure, ask one question per message. We’ll handle it step-by-step — no multi-file dumps, no assumptions.

