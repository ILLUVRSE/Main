# Control-Panel — Acceptance Evidence Template

**Purpose**
Use this template to collect and present all evidence required by reviewers when asking for final acceptance or sign-off. Copy this file into your PR or release ticket and fill the placeholders. Keep entries short and include links to logs / screenshots / CI artifacts.

---

## Metadata

* **Component:** Control-Panel
* **PR / Release:** `<link to PR or release ticket>`
* **Commit / Tag:** `<commit SHA or tag>`
* **Environment inspected:** `staging / canary / prod`
* **Reviewer(s):** `Security / SRE / Product`
* **Prepared by:** `<name>`
* **Date (ISO 8601):** `<2025-11-17T15:30:00Z>`

---

## Summary (one line)

A single-sentence summary of what was validated and the result (PASS / FAIL).

```
Summary: Verified upgrade approval → apply flow (3-of-5), emergency ratification, audit emission, and Reasoning Graph trace annotations — PASS
```

---

## Required artifacts (attach links / brief evidence)

Provide URLs or artifact names for each item. If an item is not applicable, write `N/A` and explain.

* **CI run (PR):** `<link to GitHub Actions run>`
* **Playwright report (trace / video):** `<artifact link>`
* **Server logs (control-panel):** `<link or path>`
* **Kernel logs (relevant time window):** `<link or path>`
* **Audit events sample:** `<link to audit query output / exported JSON>`
* **Reasoning Graph snapshot / trace used for verification:** `<link>`
* **Signing proof / signature output:** `<link>`
* **Screenshots / short screen recording:** `<link>`
* **Runbook execution notes (tabletop drill):** `<link or short notes>`
* **Security review ticket / signoff:** `<link>`

---

## Acceptance checklist (fill PASS / FAIL and short notes)

Copy the checklist from `control-panel/acceptance-criteria.md` and mark each item.

* **Authentication & RBAC**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
  * Notes: `<very brief>`

* **Kernel client / operator proxying (server-side)**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
  * Notes: `<e.g., verified no tokens leaked; saw header X>`

* **Upgrades workflow (approvals / multisig / apply)**

  * Result: `PASS` / `FAIL`
  * Evidence: `<playwright trace link>`
  * Notes: `<e.g., 3-of-5 succeeded, apply produced audit event id=...>`

* **Emergency ratification & rollback**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
  * Notes: `<e.g., emergency apply accepted, rollback restored state>`

* **SentinelNet & Reasoning Graph integrations**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
  * Notes: `<verdicts shown; traces annotated>`

* **Audit explorer & trace review**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
  * Notes: `<canonical payload + signature present>`

* **Signing & KMS / Signing proxy**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
  * Notes: `<KMS reachable; public key added to signers.json; or emergency override used with Security approval>`

* **Observability & metrics**

  * Result: `PASS` / `FAIL`
  * Evidence: `<prometheus graph link>`
  * Notes: `<metrics present; alerts tested>`

* **Runbooks & DR tabletop**

  * Result: `PASS` / `FAIL`
  * Evidence: `<runbook notes link>`
  * Notes: `<participants, outcome, action items>`

* **CI & Playwright**

  * Result: `PASS` / `FAIL`
  * Evidence: `<CI links + artifacts>`
  * Notes: `<retry info, flakiness, owners>`

* **Secrets & code safety**

  * Result: `PASS` / `FAIL`
  * Evidence: `<grep output / CI check logs>`
  * Notes: `No secrets in repo / private keys found?`

---

## Risk / Outstanding issues

List any unresolved items, mitigation, owner, and ETA:

* Issue: `<short title>`
  Owner: `<name/role>`
  Mitigation: `<short plan>`
  ETA: `<date or 'TBD'>`

---

## Reviewer signoff block

Security Engineer / SRE / Product must add a short signoff entry here with date.

* **Security Engineer:**
  Name: `<name>`
  Decision: `APPROVE | CONDITIONAL_APPROVAL | REJECT`
  Date: `<ISO 8601>`
  Evidence/comments: `<short>`

* **SRE:**
  Name: `<name>`
  Decision: `APPROVE | CONDITIONAL_APPROVAL | REJECT`
  Date: `<ISO 8601>`
  Evidence/comments: `<short>`

* **Ryan (SuperAdmin):**
  Name: `Ryan Lueckenotte`
  Decision: `APPROVE | CONDITIONAL_APPROVAL | REJECT`
  Date: `<ISO 8601>`
  Evidence/comments: `<short>`

---

## Optional: Attachments checklist

* [ ] Playwright trace (.zip)
* [ ] Playwright video/screenshots
* [ ] Server logs (control-panel)
* [ ] Kernel logs (relevant span)
* [ ] Audit event export (JSON)
* [ ] Reasoning Graph snapshot (signed)
* [ ] Security review ticket

---
