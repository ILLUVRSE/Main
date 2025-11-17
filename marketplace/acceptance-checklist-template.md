# Marketplace — Acceptance Checklist Template

**Use:** copy this file into a PR or release ticket and fill it out when requesting final acceptance/sign-off for Marketplace. Keep entries short and include links to artifacts (CI runs, logs, traces) rather than large paste-ins.

---

## Metadata

* **Component:** Marketplace
* **PR / Release:** `<link to PR or release ticket>`
* **Commit / Tag:** `<commit SHA or tag>`
* **Environment inspected:** `staging / canary / prod`
* **Prepared by:** `<name>`
* **Date (ISO 8601):** `<2025-11-17T15:30:00Z>`

---

## One-line summary

```
Summary: Verified checkout → payment → finance → signed proof → license → encrypted delivery flows; preview sandboxes; audit exports — PASS
```

---

## Required artifacts (attach links / short notes)

* **CI run (PR):** `<link>`
* **Unit test report / coverage:** `<link>`
* **E2E results (checkout + signed proofs):** `<link>`
* **Playwright traces / Vitest reports:** `<artifact links>`
* **Audit export sample & audit-verify run:** `<link or S3 path>`
* **Signed proof sample:** `<link>`
* **Run-local logs (minio/postgres/mocks):** `<link>`
* **Security review ticket:** `<link>`
* **Finance signoff ticket / evidence:** `<link>`

---

## Acceptance checklist (PASS / FAIL + evidence)

### A. Core API & manifest validation

* **Catalog & SKU list/detail**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
  * Notes: `<ex: manifest valid, manifestSignatureId recorded>`

* **Manifest validation (admin / PR)**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
  * Notes: `<ex: invalid manifest rejected>`

### B. Preview sandbox

* **Sandbox creation + TTL + isolation**

  * Result: `PASS` / `FAIL`
  * Evidence: `<playwright trace / logs>`
  * Notes: `<ex: sandbox expired as expected; audit event produced>`

### C. Checkout → Payment → Finance

* **Checkout idempotency & reservation**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
* **Payment webhook handling & idempotency**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
* **Finance ledger proof returned & validated**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`

### D. Finalization, license & delivery

* **Order finalization with ledger proof validation**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
* **License issuance & signature present**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
* **Encrypted delivery produced & decryptable by buyer key**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
  * Notes: `<ex: buyer-managed key test>`

### E. Signed proofs & auditability

* **Signed delivery/manifest proofs present & verifiable**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
* **Audit events emitted for order/payment/delivery with hash/signature**

  * Result: `PASS` / `FAIL`
  * Evidence: `<S3 path or audit query link>`
  * Notes: `<ex: audit-verify ran successfully>`

### F. Royalties & payouts

* **Royalty splits recorded & ledgered**

  * Result: `PASS` / `FAIL`
  * Evidence: `<link>`
  * Notes: `<ex: multi-rights SKU test>`

### G. Security & compliance

* **PCI compliance (no PAN/CVV stored; webhook verification)**

  * Result: `PASS` / `FAIL`
  * Evidence: `<security review link>`
* **KMS/Signing path configured and reachable (CI guard verified)**

  * Result: `PASS` / `FAIL`
  * Evidence: `<CI status / health probe>`
* **S3 audit archive with Object Lock configured**

  * Result: `PASS` / `FAIL`
  * Evidence: `<S3 bucket policy / sample export>`

### H. Observability & DR

* **Metrics present (checkout, delivery, audit export)**

  * Result: `PASS` / `FAIL`
  * Evidence: `<grafana / prometheus link>`
* **DR drill: DB restore + audit verify successful**

  * Result: `PASS` / `FAIL`
  * Evidence: `<runbook / DR results>`

---

## Risk & outstanding items

List any unresolved issues, owners, mitigations, and ETA:

* Issue: `<short title>`
  Owner: `<name/role>`
  Mitigation: `<short plan>`
  ETA: `<date or 'TBD'>`

---

## Signoffs (add name / role / ISO date)

* **Security Engineer:**
  Name: `<name>`
  Decision: `APPROVE | CONDITIONAL_APPROVAL | REJECT`
  Date: `<ISO 8601>`
  Evidence: `<link>`

* **Finance Lead:**
  Name: `<name>`
  Decision: `APPROVE | CONDITIONAL_APPROVAL | REJECT`
  Date: `<ISO 8601>`
  Evidence: `<link>`

* **Ryan (SuperAdmin):**
  Name: `Ryan Lueckenotte`
  Decision: `APPROVE | CONDITIONAL_APPROVAL | REJECT`
  Date: `<ISO 8601>`
  Evidence: `<link>`

---

## Attachments checklist

* [ ] CI run (unit + e2e)
* [ ] Playwright traces/videos or Vitest reports
* [ ] Audit export sample (S3 link)
* [ ] Signed proof sample (S3 or API link)
* [ ] Security review ticket / remediation notes
* [ ] Finance acceptance artifacts

---
