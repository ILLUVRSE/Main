# Finance & Billing — Specification

# # Purpose
Finance & Billing provides an auditable, production-grade financial engine for ILLUVRSE: double-entry ledgers, invoicing, payments, refunds, escrow, royalties/payouts, tax/VAT handling, and exportable audit packages. It guarantees accounting correctness, cryptographic audibility of financial events, and integration with Kernel audit and multisig governance for high-risk flows.

---

# # Core responsibilities
- Maintain a double-entry ledger (immutable, append-only journal) that records debits and credits for every financial event.
- Create and manage invoice lifecycle: drafted → issued → paid → fulfilled → closed (or refunded/voided).
- Integrate with payment processors (Stripe) for payments and refunds; handle payment confirmation webhooks securely.
- Manage escrow and payout workflows for royalties, creators, and partners.
- Enforce tax calculation (VAT/GST) per jurisdiction and generate tax reports and evidence.
- Support currency conversion and FX handling for multi-currency flows.
- Provide finance APIs for Marketplace and Kernel to request ledger entries, confirm settlements, and retrieve proofs.
- Produce signed, verifiable audit packages for external auditors and compliance teams.

---

# # Minimal public APIs (intents)
These endpoints are Kernel/Marketplace/Finance-facing (all Kernel-authenticated where applicable):

- `POST /finance/invoice` — create/issue an invoice. Payload: buyer, line_items, tax, currency, due_date, terms, related_manifest. Returns `invoiceId`.
- `GET  /finance/invoice/{id}` — fetch invoice and posting status.
- `POST /finance/payment` — record a payment (payment processor webhook or internal). Payload: invoiceId, amount, currency, payment_provider, provider_reference. Returns `paymentId` and posts journal entries.
- `POST /finance/fulfill` — mark invoice as fulfilled/delivered; triggers revenue recognition and payout accrual as required.
- `POST /finance/refund` — issue a refund (partial or full); creates reversing ledger entries, handles adjustments to royalties/payouts.
- `POST /finance/payout/run` — run a payout batch to creators/vendors. Payload: payout_date, items[]. Returns `payoutBatchId`.
- `GET  /finance/ledger/journal` — stream ledger entries (immutable) in order (supports pagination and range filters).
- `POST /finance/allocate_escrow` — lock funds in escrow for pre-release or conditional delivery.
- `POST /finance/release_escrow` — release escrow per condition (delivery, approval).
- `GET  /finance/tax/return/{period}` — produce tax return aggregation for given period and jurisdiction.
- `POST /finance/verify` — request signed proof of a ledger range (head hash, signed package) for auditors.

**Notes:** All mutating calls emit AuditEvents. Sensitive finance actions (large payouts, escrow release above threshold) require multisig approval per governance.

---

# # Canonical data models (short)

## # LedgerEntry (JournalEntry)
- `id` — uuid
- `ts` — timestamp
- `memo` — text
- `source_ref` — reference (orderId, invoiceId)
- `entries` — array of `{ account_id, debit, credit, currency, fx_rate }` — must sum to zero in base accounting currency
- `hash` — SHA-256 of canonical journal entry
- `signature` — base64 signature of `hash` by finance signer
- `posted_by` — service/actor
- `posted_at` — timestamp

## # Invoice
- `id`, `buyer_id`, `line_items[]` (sku, qty, unit_price, tax_code), `subtotal`, `tax`, `total`, `currency`, `status`, `due_date`, `terms`, `createdAt`, `issuedAt`, `paidAt`, `related_manifest`, `ledger_entries[]` (pointers).

## # Payment
- `id`, `invoiceId`, `amount`, `currency`, `provider`, `providerRef`, `status` (`pending|succeeded|failed`), `ts`.

## # Payout
- `id`, `batchId`, `recipientId`, `amount`, `currency`, `status`, `paymentProviderRef`, `ts`.

## # Escrow
- `id`, `orderId`, `amount`, `currency`, `condition`, `status` (`locked|released|cancelled`), `createdAt`, `releasedAt`.

---

# # Double-entry principles & ledger integrity
- Every financial transaction posts a JournalEntry with balanced debits and credits. JournalEntries are append-only and immutable once posted (corrections are new reversing entries).
- Ledger entries are hashed and signed. The ledger supports a head hash chain for immutability (similar to audit events) to enable cryptographic verification for auditors.
- Currency handling: ledger entries should record native currency and base accounting currency (platform currency), along with FX rate and timestamp. The balancing check occurs in base currency or with explicit FX handling.

---

# # Invoice lifecycle
1. **Draft** — invoice created but not yet issued.
2. **Issued** — invoice visible to buyer; invoice signature + audit event generated.
3. **Paid (pending)** — payment intent or provider webhook indicates payment received; finance records payment.
4. **Fulfilled** — product/service delivered (Marketplace calls `/finance/fulfill`), triggers revenue recognition rules.
5. **Closed** — final state when all settlement and recognition completed.
6. **Refunded/Voided** — refunds create reversing journal entries and update payout/royalty adjustments.

Revenue recognition must follow chosen policy (e.g., on delivery or over time) and be auditable.

---

# # Royalties, splits & payouts
- Define `royalty_rule` on SKU or contract: percentage splits among participants, platform fee, and reserved holdbacks.
- On sale: marketplace triggers finance to create payable accruals (deferred revenue) and pending payout line items for owners.
- Payout run: scheduled or on-demand, Finance generates payout files, executes transfers via PSP or bank rails, and emits `payout.run` audit events.
- Payout failures: retry logic, alerting, and manual reconciliation UI required. Payout reversals on refunds/chargebacks require clawback logic recorded in ledger.

---

# # Escrow & conditional settlements
- Escrow allows funds to be locked until conditions met (delivery, QA, acceptance). Escrow creation posts `Escrow` record and corresponding ledger reservation.
- Release requires verification of condition (via Kernel audit event or multisig ratification) and emits ledger entries moving funds from escrow to payable and then to payout upon schedule.

---

# # Tax & compliance
- Tax engine calculates tax per line item based on jurisdiction rules and buyer location (VAT/GST). Must store tax evidences (buyer address, VAT ID) for audit.
- Produce tax returns and evidence packages per jurisdiction and period: `GET /finance/tax/return/{period}`.
- Ensure transactional records include tax amounts and supporting data; support OSS/VOEC flows where applicable.

---

# # Auditability & proofs
- Finance must produce cryptographically verifiable audit packages: canonicalized journal segment + head hash + signature(s).
- Support `GET /finance/verify` to request a signed proof for a given date range or sequence of journal entries. Proofs include public key metadata to verify signatures.
- Exports for auditors include invoice PDFs, signed journal entries, payment confirmations, and settlement/payout files.

---

# # Security & governance
- Sensitive operations (large payouts, escrow release > threshold) require multisig approval via Kernel multisig workflow.
- All finance endpoints require mTLS + RBAC. Human UI operations require SSO/OIDC with 2FA.
- Keys for signing ledger entries and audit proofs must be managed in KMS/HSM and rotated per policy. Access to signing keys logged and limited.

---

# # Integrations
- **Marketplace** — invoices and order settlements.
- **Kernel** — manifest signatures, audit events, multisig gating.
- **Payment provider (Stripe)** — payment intents, webhooks, refunds.
- **Accounting systems** — export formats (CSV, Xero/QuickBooks connectors) for external accounting systems.
- **Finance reporting** — dashboards and exports for accounting and compliance.

---

# # Error handling & reconciliation
- Provide reconciliation tools and APIs to reconcile payments, payouts, and ledger balances.
- Implement idempotency for webhook processing and guard against double-posting.
- Support manual adjustments with required audit justification and ledger corrections (reversing entries).

---

# # Reporting & dashboards
- Provide financial dashboards: AR/AP, deferred revenue, realized revenue, outstanding invoices, payout liabilities, VAT owed, and cash position.
- Exportable reports for CFO/Finance and auditors.

---

# # Deployment & infra notes (brief)
- Run Finance as a secure, isolated service with strict network controls and dedicated DB.
- Use managed Postgres and ensure encryption at rest and in transit.
- Backups: frequent snapshots and PITR for Postgres; ledger integrity verification job.
- Use KMS/HSM for signing. Ensure physical/operational controls for production finance keys.

---

# # Acceptance criteria (minimal)
- Double-entry ledger implemented: every transaction posts balanced journal entries and can be verified.
- Invoice lifecycle implemented end-to-end: create → issue → payment → fulfill → close.
- Payment integration: record payment webhooks idempotently and post ledger entries accordingly.
- Payouts: schedule/run payouts with audit events and handle failures/retries.
- Escrow: lock and release funds with auditable conditions and ledger movements.
- Tax: calculate tax per jurisdiction and produce tax return aggregation.
- Audit proofs: produce signed ledger proofs for a date range and verify signatures.
- Multisig gating: high-risk finance actions require 3-of-5 approvals and are enforced.
- Security: mTLS + RBAC, KMS/HSM for signing, and secrets not stored in repo.
- Tests: unit, integration, and reconciliation tests present and passing.

---

# # Example flow (short)
1. Marketplace creates `invoice` for order `order-123` → Finance records invoice `inv-001` and emits `invoice.issued` audit event.
2. Buyer pays via Stripe; webhook calls `POST /finance/payment` with providerRef. Finance records payment, posts journal entries (debit cash, credit deferred revenue), emits `payment.received` audit event.
3. Marketplace calls `POST /finance/fulfill` once delivery confirmed. Finance recognizes revenue (moves deferred revenue → sales revenue) and creates accruals for royalties.
4. Finance schedules `payout.run` for owners; payouts executed and audit events recorded. Refund scenario: reverse journal entries and adjust payouts.

---

End of file.

