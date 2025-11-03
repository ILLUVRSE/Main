# Finance — Acceptance Criteria

Purpose: short, verifiable checks proving the Finance service is correct, auditable, secure, and production-ready. Each criterion is actionable and testable.

---

# # 1) Ledger integrity
- **Balanced journal:** Every JournalEntry posted is balanced (debits == credits in base currency after FX handling).
- **Append-only:** Journal entries are append-only; corrections are new reversing entries referencing originals.
- **Hash & signature:** Each JournalEntry includes `hash` and `signature`; the head hash chain verifies end-to-end.

**How to verify:** Post test transactions, run head-hash verification job and validate signatures; attempt tamper and confirm detection.

---

# # 2) Invoice lifecycle
- **End-to-end:** Create → Issue → Payment → Fulfill → Close (or Refund) completes normally.
- **Audit linkage:** Invoice issuance, payment, and fulfillment emit AuditEvents and ledger postings.

**How to verify:** Create sample invoice, simulate payment webhook, call fulfill, and confirm ledger entries and audit events for each stage.

---

# # 3) Payment provider integration & idempotency
- **Webhook idempotency:** Payment webhooks are processed idempotently; duplicate webhooks do not double-post.
- **Reconciliation:** Automated reconciliation matches provider transactions to ledger and flags mismatches.

**How to verify:** Send duplicate webhook payloads and confirm single ledger post; run reconciliation job and inspect results.

---

# # 4) Payouts & escrow
- **Payout batching:** Payout run creates payout batch, executes transfers (or simulates in staging), and emits audit events.
- **Escrow correctness:** Escrow creation and release post appropriate reservation and release journal entries.
- **Multisig gating:** Large or policy-defined payouts/escrow releases require multisig approval (3-of-5) and are blocked until quorum.

**How to verify:** Run payout batch in staging, simulate escrow release with and without multisig and confirm behavior and audit trail.

---

# # 5) Refunds & reversals
- **Reversing entries:** Refunds create reversing journal entries and adjust royalties/payouts.
- **Clawbacks:** Payout adjustments occur when refunds/chargebacks trigger clawbacks; audit events record adjustments.

**How to verify:** Issue invoice → payment → payout → refund; confirm ledger reversing entries and payout adjustments.

---

# # 6) Tax & compliance
- **Tax calculation:** Tax per jurisdiction computed and stored with invoice evidence (buyer address, VAT ID).
- **Tax return aggregation:** `GET /finance/tax/return/{period}` produces required aggregation with evidence for the period.

**How to verify:** Create taxable invoices across jurisdictions and verify tax return output and evidentiary records.

---

# # 7) Audit proofs & exports
- **Proof generation:** `POST /finance/verify` produces a canonicalized, signed proof (journal segment + head hash + signature).
- **Export completeness:** Auditor export includes invoices, payments, journal entries, and signatures.

**How to verify:** Generate proof for a date range and validate signature and canonical payload; auditors can verify success.

---

# # 8) Security & key management
- **KMS/HSM signing:** Ledger and proof signing keys exist in KMS/HSM; private keys never in cluster. Key rotation documented.
- **mTLS & RBAC:** Service-to-service uses mTLS; human UI uses OIDC/SSO with 2FA.
- **Secrets:** No secrets in repo; Vault used for dynamic creds.

**How to verify:** Confirm signing performed by KMS/HSM (no private key in app), test mTLS enforcement, and ensure Vault usage.

---

# # 9) Disaster recovery & backups
- **Backups & PITR:** Postgres PITR and snapshots configured; restore drill succeeds.
- **Ledger replay:** Ability to rebuild indices / verification state by replaying archived journal events from S3/Kafka.

**How to verify:** Restore from backup to a staging cluster; run replay and confirm ledger and proof integrity.

---

# # 10) Performance & SLAs
- **Latency:** Synchronous journal posting and invoice creation meet p95 latency targets (documented).
- **Throughput:** System handles expected invoices/payments per minute under load tests.

**How to verify:** Run load tests and measure latencies against SLOs.

---

# # 11) Tests & automation
- **Unit tests:** core accounting invariants (balancing, reversal logic) covered.
- **Integration tests:** end-to-end invoice → payment → fulfill → payout → refund flows, including multisig gating.
- **Reconciliation tests:** automated reconciliation and alerts on mismatch.

**How to verify:** Run CI test suite and integration tests; validate test coverage for critical paths.

---

# # 12) Operations & monitoring
- **Alerts:** ledger imbalance, signing failures, payout failures, reconciliation drift, and webhook errors alert correctly.
- **Metrics & tracing:** expose metrics (posting latency, payout success rate, reconciliation lag) and tracing for core flows.

**How to verify:** Simulate failures and confirm alerts; inspect metrics and traces for expected signals.

---

# # 13) Documentation & sign-off
- **Docs present:** `finance-spec.md`, `deployment.md`, `README.md`, and this acceptance file exist.
- **Sign-off:** Finance lead, Security Engineer, and Ryan sign off. Sign-off is recorded as an AuditEvent.

**How to verify:** Confirm files are present and obtain written sign-off recorded via audit.

---

# # Final acceptance statement
Finance service is accepted when all criteria above pass in staging, automated tests are green, ledger integrity and proofs validate, security and key management checks pass, and formal sign-off by Finance lead, Security Engineer, and Ryan is recorded.


