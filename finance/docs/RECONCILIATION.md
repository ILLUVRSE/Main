# Finance — Reconciliation & Auditor Export Runbook

**Purpose**
Operational runbook and specifications for Finance reconciliation: how to generate reconciliation reports that compare external payment provider data (e.g., Stripe / PSP) with internal ledger entries, produce discrepancy reports, export auditor bundles, and run DR/verification. This doc defines formats, automation, and remediation steps so Finance and SRE can operate reconciliation safely and repeatably.

**Audience:** Finance Engineers, SRE, Auditor, Security

---

## 1 — Goals & scope

* Provide deterministic reconciliation between external payment provider records and Finance ledger/journal entries for a given date range.
* Record discrepancies with actionable classification (missing payment, missing ledger, amount mismatch, currency mismatch).
* Produce auditor-ready export bundles containing ledger rows, proofs, and reconciliation reports, signed with Finance signer.
* Provide replayable tooling so auditors or on-call can reproduce reconciliation and proofs in DR.

---

## 2 — Reconciliation concepts & terminology

* **Provider record** — raw payment provider record (payment_intent / transaction) for a settlement.
* **Ledger entry** — Finance journal rows representing the settlement (debit/credit).
* **Match** — a provider record maps to a ledger entry with matching amount & currency and proper settlement status.
* **Discrepancy** — any mismatch; categorized as:

  * `PROVIDER_MISSING` — provider has no record matching the ledger context (rare reverse case).
  * `LEDGER_MISSING` — provider shows payment but no ledger/journal posted.
  * `AMOUNT_MISMATCH` — amounts differ.
  * `CURRENCY_MISMATCH` — currencies differ.
  * `DUPLICATE_PROVIDER` — duplicate payment intents detected.
  * `DUPLICATE_LEDGER` — duplicate journal entries detected.
  * `TIMING_WINDOW` — expected timing mismatch (e.g., provider shows late settlement).
  * `OTHER` — requires manual investigation.

---

## 3 — Reconciliation API (Finance)

Finance implements these endpoints (see `finance/api.md` for other APIs):

* `POST /reconcile` — start a reconciliation job.

  Body:

  ```json
  {
    "request_id": "rec-20251117-001",
    "from_ts": "2025-11-01T00:00:00Z",
    "to_ts": "2025-11-30T23:59:59Z",
    "provider": "stripe",
    "options": {
      "time_tolerance_seconds": 3600,
      "allow_small_delta_cents": 0
    }
  }
  ```

  Response:

  ```json
  { "ok": true, "reconcile_id": "reconcile-20251117-001", "status": "running" }
  ```

* `GET /reconcile/{id}` — fetch reconciliation status & results.

  Response:

  ```json
  {
    "ok": true,
    "reconcile_id": "reconcile-20251117-001",
    "status": "completed",
    "summary": {
      "total_provider_records": 1000,
      "total_ledger_entries": 995,
      "matches": 990,
      "discrepancies": 10
    },
    "discrepancies": [ /* detailed list */ ],
    "export_s3_path": "s3://illuvrse-audit-archive/prod/reconcile/2025-11/reconcile-20251117-001.jsonl.gz"
  }
  ```

* `GET /reconcile/{id}/report` — download or view JSONL report with detailed rows.

---

## 4 — Reconciliation job behavior

* **Fetch provider data** for the given range via the provider API (use provider paging & webhooks when available). Provider fetch must be idempotent and retryable.
* **Fetch ledger rows** with context for the same range (journal lines, invoice refs, settlement refs). Use canonical ordering (by timestamp + id).
* **Matching algorithm**:

  1. Attempt to match by `payment_reference` / `provider_reference` → `journal.context.payment_reference` or `journal.context.order_id`.
  2. If no direct reference, match by amount + currency + time window.
  3. If multiple candidates, flag duplicates for manual review.
* **Tolerance**: allow configurable tolerances for timing windows and small cent rounding discrepancies (`allow_small_delta_cents`).
* **Output**: produce a detailed JSONL report with one line per provider record and one line per ledger row that was not matched or flagged.

---

## 5 — Reconciliation report format (JSONL)

Each line is an object with a `type` and `data` fields.

Example matched provider record:

```json
{
  "type": "match",
  "data": {
    "provider": "stripe",
    "provider_id": "pi_abc123",
    "provider_amount_cents": 19999,
    "provider_currency": "USD",
    "provider_ts": "2025-11-17T12:00:00Z",
    "journal_id": "jrn-20251117-0001",
    "journal_entries": [ /* array */ ],
    "match_reason": "reference_match"
  }
}
```

Example discrepancy:

```json
{
  "type": "discrepancy",
  "data": {
    "discrepancy_type": "LEDGER_MISSING",
    "provider": "stripe",
    "provider_id": "pi_xxx",
    "provider_amount_cents": 19999,
    "provider_currency": "USD",
    "provider_ts": "2025-11-17T12:00:00Z",
    "notes": "No ledger entries found for provider reference or amount/time window"
  }
}
```

At the end of the JSONL a `summary` line is appended:

```json
{
  "type": "summary",
  "data": {
    "total_provider": 1000,
    "total_ledger": 995,
    "matches": 990,
    "discrepancies": 10
  }
}
```

---

## 6 — Auditor export bundle

When reconciliation completes, Finance must create an auditor bundle (gzipped JSONL or tar.gz) placed in `S3_AUDIT_BUCKET` with Object Lock and with metadata:

* `service=finance`
* `env=production|staging`
* `reconcile_id`
* `from_ts`, `to_ts`
* `pii_included` (true/false)
* `pii_policy_version`
* `signer_kid`
* `signed`: boolean

**Bundle contents**

* `reconcile-report.jsonl.gz` — the JSONL reconciliation report (as above).
* `ledger_rows.jsonl.gz` — canonicalized ledger rows for the range.
* `provider_records.jsonl.gz` — canonicalized provider records.
* `proof.json` — signed proof for the ledger range (produced by Finance signer).
* `manifest.json` — metadata & `pii_policy_version`.

**Signing**

* Before uploading, Finance signs the `proof.json` (or includes a signed `proof.json`). The entire bundle metadata is anchored via a signed manifest for auditor chain-of-trust.

---

## 7 — Reconciliation workflow & operator steps

### Manual reconciliation run

1. Operator: `POST /reconcile` with range and provider.
2. Wait for `status: completed` on `GET /reconcile/{id}` or poll.
3. Download `GET /reconcile/{id}/report` or fetch `export_s3_path`.
4. Review `discrepancies` rows and follow remediation.

### Remediation steps by discrepancy type

* **LEDGER_MISSING**

  * Investigate provider source & webhook logs. If provider has valid settled payment, create ledger journal with `context.source=provider` and reference provider id. Ensure idempotency keys used.
  * If provider record is duplicate/phantom, contact payment provider support.

* **PROVIDER_MISSING**

  * Validate whether external provider was delayed or removed; if ledger entry is valid, investigate provider. If ledger created in error, create reversing journal and remedy accounting.

* **AMOUNT_MISMATCH / CURRENCY_MISMATCH**

  * Check for FX adjustments, partial refunds, or fee deductions. Reconcile with provider’s fee reports and create adjusting journal entries where appropriate.

* **DUPLICATE_PROVIDER / DUPLICATE_LEDGER**

  * Identify duplicates via idempotency keys; de-duplicate by reversing duplicate entries or merging per policy.

* **TIMING_WINDOW**

  * If provider settlement comes after window, schedule a re-run with expanded `time_tolerance_seconds`.

Always record actions and rationale as AuditEvents (operator + reason).

---

## 8 — Automation & scheduled runs

* **Nightly full-run**: schedule a daily job that reconciles previous day’s activity for all providers and stores export bundles in `S3_AUDIT_BUCKET`.
* **Weekly audit bundle**: aggregate weekly bundles and produce signed proof for auditors.
* **On-demand runs**: Operators may start ad-hoc reconciliation for specific ranges.

**Retry semantics**

* Reconciliation job must be idempotent and support retries. Use job IDs and persistent checkpointing (pagination cursor per provider).

---

## 9 — Tools & verification

### Local debug commands

* Start reconcile (example CLI):

```bash
curl -X POST https://finance.local/reconcile \
  -H "Authorization: Bearer $FINANCE_ADMIN_TOKEN" \
  -d '{"request_id":"rec-test-1","from_ts":"2025-11-01T00:00:00Z","to_ts":"2025-11-30T23:59:59Z","provider":"stripe"}'
```

* Fetch reconcile result:

```bash
curl -fsS https://finance.local/reconcile/rec-test-1 -H "Authorization: Bearer $FINANCE_ADMIN_TOKEN" | jq
```

* Download export (S3 or direct):

```bash
# If S3 path provided, use aws cli or mc to download.
aws s3 cp s3://illuvrse-audit-archive/prod/reconcile/2025-11/reconcile-20251117-001.jsonl.gz /tmp/
```

### Verify signed proof

* Use `finance/tools/verify_proof.js` or `node` script that loads `proof.json` and verifies signature with the public key for `signer_kid`.

---

## 10 — Monitoring & alerts

Reconciliation jobs should emit metrics:

* `finance.reconcile_jobs_total` (counter, labels `{provider, status}`)
* `finance.reconcile_duration_seconds` (histogram)
* `finance.reconcile_discrepancies_total` (counter, label `{type}`)
* `finance.audit_export_success_total` and `_failure_total`

Alerts:

* Discrepancies above threshold (e.g., > 0.1% daily volume).
* Reconcile job failures or export failures.
* Large numbers of `DUPLICATE_*` discrepancies.

---

## 11 — DR & auditor verification

* Periodically (monthly) run a full reconciliation against restored DB in a test cluster to verify reproducibility.
* Re-run proof generation on restored DB and verify signatures using `audit-verify` / `finance/tools/verify_proof.js`.
* Store DR run artifacts in `S3_AUDIT_BUCKET` under `dr-drill/<date>/` with proof and reconciliation report.

---

## 12 — Access control & auditability

* Reconciliation and export endpoints limited to operator/Admin roles and require `reconcile:run` capability.
* Every reconciliation run and any subsequent remediation must produce AuditEvents containing `actor`, `reason`, `reconcile_id`, and `evidence_links`.

---

## 13 — Example incident workflow

**If high discrepancy spike occurs:**

1. Flag incidents: `finance.reconcile_discrepancies_total` spike alerts on-call.
2. Triage: run ad-hoc reconcile for the impacted range with expanded time tolerance.
3. Narrow down discrepancy types (duplicates, missing ledger, etc.).
4. If caused by external provider issue, contact provider support and freeze payouts as needed.
5. Remediate ledger errors (reversals / adjustments) with documented audit justification.
6. Run reconciliation again to confirm remediation.
7. Post-incident: produce RCA and update reconciliation tests to catch the failure mode.

---

## 14 — Testing & CI

* **Unit tests**: matching logic, tolerance, duplicate detection.
* **Integration tests**: mock provider & ledger rows; simulate duplicates/timeouts; assert report.
* **E2E**: run a full reconciliation against run-local mock providers and verify export and proof signing.
* **CI**: run reconciliation tests as part of `finance-ci` and include `audit-verify` on sample outputs.

---

## 15 — Sign-off & documentation

* Security and Finance Lead must approve reconciliation implementation and export policies.
* Publish sample reconcile reports to the auditor team and include instructions for verifying signatures & proofs.

---

End of runbook.

