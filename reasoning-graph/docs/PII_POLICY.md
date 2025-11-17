# Reasoning Graph — PII Policy & Redaction Rules

**Purpose**
Define the classification, redaction, handling, and testing rules for Personally Identifiable Information (PII) stored in or surfaced by the Reasoning Graph. This document is an operational policy and testable specification intended for engineers, Security, and auditors. It must be implemented and enforced before production sign-off.

**Scope**
Applies to all Reasoning Graph APIs, snapshots, traces, annotations, and exported artifacts. Covers data at rest, data in transit, operator UI surfaces, signed snapshots, and audit exports.

---

## 1 — PII classification (canonical categories)

Classify fields and payloads into these categories:

1. **Direct Identifiers** (HIGH) — uniquely identify an individual
   Examples: `email`, `phone_number`, `national_id`, `ssn`, `passport_number`, `full_name` (if unique in context).

2. **Quasi-identifiers** (MEDIUM) — require combination to identify
   Examples: `birth_date`, `postal_code`, `city`, `device_id`, `ip_address`.

3. **Sensitive Attributes** (HIGH) — sensitive personal attributes
   Examples: race, religion, political opinions, health conditions.

4. **Non-PII / Operational** (LOW) — not PII
   Examples: algorithm scores, internal IDs that cannot be mapped to a person, aggregated counts.

**Implementation:** Maintain a canonical `reasoning-graph/docs/pii-catalog.json` (or YAML) mapping field names and JSON paths to categories so redaction code uses a single source of truth.

---

## 2 — Redaction rules & outputs

**Policy:**

* **By default**, traces returned to any principal **without** explicit `read:pii` capability must have all HIGH and MEDIUM fields redacted.
* **Minimal disclosure:** Only return the minimal non-PII attributes required for debugging unless `read:pii` approved.
* **Auditor exceptions:** Auditors with explicit authorization may see signed snapshots containing PII, but snapshots MUST be marked with `audience: auditor` and stored with stricter retention & access controls.

**Redaction levels**

* `REDACTED_SUMMARY` — replace sensitive value with a short token: `"[REDACTED:EMAIL]"` or `"[REDACTED:PII-HASH:<prefix>]"`. Use for UI summaries.
* `PII_HASH` — deterministic salted hash for correlation across traces when allowed (salt stored in Vault and rotated). Format: `{algorithm}:{saltPrefix}:{hashHex}`. Use only when correlation is permitted and after Security approval.
* `FULL_REMOVAL` — remove field entirely (used for exported snapshots for public auditors or cheap debug views).

**Which to use**

* UI operator views (non-auditor): use `REDACTED_SUMMARY` for HIGH/ SENSITIVE fields; `PII_HASH` may be allowed for MEDIUM fields for safe correlation if explicitly permitted.
* Signed snapshots for auditors: may include PII if `audience: auditor` and stored under stricter guard, otherwise must use `FULL_REMOVAL` or explicit redaction per audit scope.
* Exported public traces: must use `FULL_REMOVAL`.

---

## 3 — Access control & capability model

* **Principle of least privilege:** access only to the minimal scope of PII necessary. Enforce via Kernel-authorized RBAC claims and internal policies.
* **Capabilities:** `read:pii`, `annotate:pii`, `export:pii`. These flags must be granted via Kernel RBAC and included in caller identity.
* **Auditor access:** Create short-lived auditor roles that require multi-factor approval and are logged with an explicit audit event containing justification and signer KID.

**Implementation notes**

* The Reasoning Graph must check Kernel-supplied role claims for `read:pii` at request time. If missing, the middleware must apply redaction rules.

---

## 4 — Redaction algorithm & canonicalization

**Canonicalization prior to redaction:** For deterministic hashing and signing, canonicalize the payload using the same canonicalization rules used for snapshots (must be byte-for-byte consistent with Kernel parity rules). See `reasoning-graph/test/node_canonical_parity.test.js` style tests. 

**Hashing policy**

* Use SHA-256 with a per-environment secret salt stored in Vault. Salt rotation procedure must be documented and supported with rehash support where necessary.
* Hashed PII must be prefixed with a stable, auditable salt identifier so future verification is possible.

**Example**

* Original: `{ "email": "alice@example.com" }`
* Redacted summary: `{ "email": "[REDACTED:EMAIL]" }`
* PII hash: `{ "email_hash": "sha256:v1:af3b..."} ` (only if `read:pii` capability allows correlation)

---

## 5 — Signed snapshots & PII

**Policy**

* Snapshots that include PII must:

  * Be explicitly labeled: `audience: auditor` and `pii_included: true`.
  * Be stored in a restricted S3 bucket with object-lock and stricter IAM (audit-only access).
  * Include an audit event that records who requested the snapshot, justification, and signer KID.

**Implementation**

* The snapshot generation API must accept an `audience` parameter and enforce approval flows for `auditor`.
* Snapshot signers must include a `pii_policy_version` tag indicating which redaction policy produced the snapshot.

---

## 6 — Annotations & corrections

* Annotations (operator-provided textual notes or corrections) may contain PII. They are append-only and must be processed by the same redaction pipeline before being returned to non-privileged principals.
* Annotations recorded in Reasoning Graph should themselves produce AuditEvents and, where PII is included, be stored and exported under the same controls as snapshots.

---

## 7 — Storage & export controls

* Snapshots and audit exports that include PII must be written to S3 with Object-Lock & access restricted to an auditor IAM group. Retention must match legal/regulatory requirements.
* Export manifests must include `pii_included` boolean and `pii_policy_version` string.

---

## 8 — Testing requirements (blocking)

For every code change touching redaction, run these tests:

1. **Unit tests**

   * Redaction unit tests for each PII category and JSON path.
   * Tests for `PII_HASH` deterministic output with known salt.
   * Tests ensuring `FULL_REMOVAL` removes field entirely.

2. **Integration tests**

   * Role-based tests: call `GET /trace/{id}` as `read:pii` and as non-PII reader and verify outputs differ per policy.
   * Snapshot signing test: produce a signed snapshot for auditor audience and verify snapshot metadata and storage guard.
   * Parity test: canonicalize payload before redaction and after redaction to ensure proofs & signature flows remain verifiable when allowed.

3. **E2E tests**

   * A simulated flow where Eval Engine produces a trace with PII in payload: verify redaction in non-PII views, that the auditor snapshot contains PII only with explicit justification, and audit events logged.

4. **Automated CI checks**

   * Linter that checks `pii-catalog.json` coverage for known fields.
   * Unit test coverage thresholds for redaction code.

---

## 9 — Operational procedures & audits

**Routine audits**

* Monthly automated audit verifying no PII leaks in public snapshots and that `pii_included` snapshots are present only in restricted buckets.
* Quarterly review of `pii-catalog.json` by Security & Legal to account for new data fields.

**Incident procedure**

* If a PII leak is suspected, follow the secret compromise runbook:

  * Rotate salts and keys, revoke access, snapshot & export affected data for forensic analysis, notify Security, and run audit-verify to ensure the integrity of audit chain.

---

## 10 — Roles & responsibilities

* **Security**: approve `pii-catalog.json` and sign-off on PII policy changes.
* **Legal / Compliance**: define retention & export rules.
* **Reasoning Graph Engineers**: implement redaction middleware and tests.
* **SRE**: enforce storage and object-lock configuration, run periodic audits.

---

## 11 — Policy versioning & change log

* Maintain a `pii_policy_version` string in `reasoning-graph/docs/PII_POLICY_VERSION` and include it in all snapshots and audit events.
* Changes to the policy must include:

  * Change summary, author, date, and security signoff in the change log.
  * Migration plan for existing snapshots/exports if redaction semantics change.

---

## 12 — Minimal PR checklist (for changes touching PII)

* [ ] `pii-catalog.json` updated (if new fields added)
* [ ] Unit tests added for new fields/path redaction
* [ ] Integration tests for role-based access added/updated
* [ ] `pii_policy_version` bumped and documented in change log
* [ ] Security review ticket attached and Security Engineer sign-off included

---

### Appendix: example `pii-catalog.json` (snippet)

```json
{
  "fields": [
    { "json_path": "$.actor.email", "category": "DIRECT_IDENTIFIER", "notes": "User email" },
    { "json_path": "$.actor.ip", "category": "QUASI_IDENTIFIER", "notes": "IP address" },
    { "json_path": "$.payload.health_condition", "category": "SENSITIVE", "notes": "Health condition" }
  ],
  "policy_version": "2025-11-17-v1"
}
```

---

**Sign-off:** Security Engineer must review and sign this policy for `reasoning-graph` production promotion. Add `reasoning-graph/signoffs/security_engineer.sig` with the template used in RepoWriter.

---
