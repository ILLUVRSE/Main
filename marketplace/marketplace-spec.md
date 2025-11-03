# Marketplace & Delivery — Specification

# # Purpose
The Marketplace is the platform where users discover, preview, buy, and receive versioned, signed, and optionally encrypted SKUs (agent bundles, software, worlds, models, or services). The Delivery system guarantees secure, auditable delivery and license issuance. The Marketplace enforces ownership, royalties, and auditability; all purchases and deliveries are recorded in the Kernel audit bus.

---

# # Core responsibilities
- Catalog & discoverability: store SKU metadata, tags, categories, pricing, previews, and versioning.
- Preview & sandbox: enable live or demo previews (sandboxed containers) so buyers can evaluate SKUs before purchase.
- Checkout & payments: integrate with payment processors (Stripe or similar) and Finance for ledger entries.
- License issuance: create signed licenses (immutable, transferable per SKU) and store license metadata.
- Encrypted delivery: produce signed, encrypted bundles (artifact.tar.enc) with short-lived decryption keys or buyer public-key delivery.
- Ownership & provenance: sign bundles and record provenance (manifest, signerId, artifact checksums).
- Royalties & revenue split: record split rules and integrate with Finance for automated payouts.
- Admin & promotions: tools to manage pricing, promotions, and catalog lifecycle.
- Audit & compliance: every purchase, delivery, refund, and license transfer must emit AuditEvents and be verifiable.
- Fraud & policy checks: SentinelNet evaluates purchases and deliveries for fraud, policy, or legal constraints.

---

# # Minimal public API (intents)
These are Kernel-facing / external API endpoints (implement as service APIs):

- `GET  /market/sku` — list SKUs with filters (category, tag, price range, owner).
- `GET  /market/sku/{id}` — retrieve SKU metadata and preview links.
- `POST /market/preview/{skuId}` — request a preview (creates a temporary sandbox). Returns `previewId` and `url`.
- `POST /market/purchase` — create an order (skuId, buyerId, paymentMethod, licenseOptions). Returns `orderId` and payment intent.
- `GET  /market/order/{id}` — fetch order status and license/download links once paid.
- `POST /market/checkout/webhook` — payment processor webhook for confirmations (authenticated).
- `POST /market/purchase/{orderId}/deliver` — trigger delivery; used by marketplace after payment verification.
- `GET  /market/download/{orderId}` — return signed, time-limited download URL or license and decryption instructions.
- `POST /market/license/{licenseId}/verify` — verify license authenticity and ownership.
- `POST /market/refund/{orderId}` — start a refund; integrates with Finance and triggers license revocation if needed.
- `POST /market/addon/{orderId}` — attach add-on module to an existing license (paid or free).
- `GET  /market/owner/{ownerId}/sales` — owner reporting API (sales, royalties). (RBAC-protected)

**Notes:** All mutating endpoints require Kernel-authenticated calls or verified user sessions (OIDC). Deliveries must reference a signed ManifestSignature for the SKU version.

---

# # SKU model & delivery artifacts
- **SKU** (immutable bundle version):
  - `skuId`, `name`, `description`, `ownerId`, `version`, `price`, `currency`, `previewType` (`live|video|demo`), `tags`, `licensePolicyId`, `artifacts[]` (artifactId), `manifestId`, `signerId`, `signature`, `createdAt`, `status` (`draft|published|retired`).
- **Artifact bundle**: signed tarball with a manifest, checksums, and metadata. For encrypted delivery: `artifact.tar.enc` + delivery manifest with `encKeyRef` or recipient public-key info.
- **License**: signed JSON with `licenseId`, `skuId`, `ownerPublicKey` or `buyerId`, `transferable` (bool), `machineLimit`, `expiry` (optional), `termsRef`, `signature`, `issuedAt`.
- **Delivery record**: `orderId`, `licenseId`, `downloadUrl` (signed, short-lived), `deliveryTs`, `receiptId`.

**Delivery security:** bundles are signed (Ed25519) and encrypted when required. For encrypted delivery, prefer buyer public-key encryption (asymmetric) or HSM-issued ephemeral keys. Decryption keys must be short-lived and only available after payment and license issuance.

---

# # Checkout, payment & finance flow
1. **Create order** — buyer selects SKU and submits purchase. Marketplace creates `order` with `pending` status.
2. **Payment intent** — Marketplace calls payment provider (Stripe) to create payment intent; Kernel records the intent and issues audit event.
3. **Webhook confirmation** — payment processor sends webhook to Marketplace; Marketplace verifies and then records payment success.
4. **Finance reconciliation** — Marketplace notifies Finance to create ledger entries, confirm balances, and prepare royalty splits. Finance returns confirmation.
5. **License issuance & delivery** — upon finance confirmation, Marketplace creates signed license, records license in DB, creates delivery artifact (signed/encrypted), and returns download URL or decryption instructions to buyer. Audit events emitted at each step.
6. **Payouts** — Marketplace triggers payouts to owners per royalty rules via Finance (automated or scheduled).

**Edge cases:** failed payment, chargebacks, refunds: trigger refund flow, license revocation, and ledger reversal. All actions produce audit events. Refunds may require license revocation and artifact access suspension.

---

# # Preview & sandbox
- **Types:** live sandbox (container), recorded demo, video. Live sandboxes must run in isolated environments and time-limited (e.g., 10–30 minutes).
- **Security:** sandbox network egress blocked or monitored; sandbox runs with limited resources and ephemeral storage. Sandboxes are instrumented to prevent data exfiltration and audited.
- **Costs:** previews can consume compute; limit per buyer and require quotas.

---

# # Licensing & ownership
- **License types:** `non-transferable`, `transferable`, `subscription`, `perpetual`. Each SKU defines license rules.
- **License verification:** `POST /market/license/{licenseId}/verify` checks signature and returns ownership and validity. Optionally support on-chain verification (blockchain hash) for proofs.
- **Transfers:** if license is transferable, provide `POST /market/license/transfer` which performs checks, emits AuditEvent, and updates owner. Transfers may require escrow/payout adjustments.

---

# # Royalties & splits
- **Split rules:** SKU includes `royalty` metadata describing split percentages to owner(s), platform fee, and optional third-party splits (creators).
- **Payouts:** Finance processes payouts per schedule; Marketplace provides settlement reports and `owner/sales` APIs.
- **Chargebacks:** handle reversals and reconcile payouts (clawbacks where applicable) with Finance; record all actions.
- **Reporting:** provide CSV/JSON export for owners with totals, fees, and pending payouts.

---

# # Security, compliance & policy
- **Manifest signing:** each SKU version must be signed by owner or Kernel signer and stored with ManifestSignature references.
- **Content policy:** SentinelNet scans listings for policy violations (copyright, PII, export control). Block or require manual review for flagged SKUs.
- **Export controls & region blocks:** respect jurisdictional restrictions (geofencing) and block sale/delivery per `marketplace` policies.
- **Personal data:** ensure buyer PII handled per GDPR; store minimal PII in Marketplace DB and use Finance for payment info. Provide deletion/portability workflows adhering to law while preserving audit trail (use redaction or sealed archives where required).

---

# # Audit & immutability
- All orders, payments, license issuances, deliveries, refunds, and license transfers produce AuditEvents (hash + signature). Delivery artifacts include checksums and are stored with immutable metadata in S3.
- Provide export for auditors: canonical purchase logs + signatures + artifact checksums + license stack.

---

# # Acceptance criteria (minimal)
- SKU catalog API implemented and searchable.
- End-to-end checkout flow: create order → payment confirmation → Finance reconciliation → license issuance → delivery URL encryption and audit events.
- License verification endpoint returns valid signature verification and ownership.
- Preview sandbox flow works with isolated environment and expiration.
- Royalties calculated correctly and Finance receives settlement requests.
- Refunds revoke license access and generate correct ledger adjustments.
- SentinelNet blocks a policy-violating SKU or purchase.
- Audit trail present for all steps and verifiable via hash/signature checks.

---

# # Operational & deployment notes (brief)
- Use managed payment provider (Stripe) for PCI compliance; never store raw card data.
- Delivery artifacts and license records live in S3 with versioning and object lock enabled for audit.
- Sandboxes run in Kubernetes with strict network policies and per-preview quotas.
- Keep a transactions queue for reliable delivery and retries in case of infra failures.
- Monitor fraud signals and connect to SentinelNet for adaptive blocking.

---

# # Example simple purchase flow (short)
1. Buyer requests `POST /market/purchase` for `sku-123`. Marketplace creates order and payment intent.
2. Payment completes; webhook notifies Marketplace. Marketplace records payment, emits audit event, and calls Finance.
3. Finance confirms ledger entry; Marketplace issues signed license and creates encrypted delivery bundle.
4. Buyer downloads bundle via `GET /market/download/{orderId}`, uses provided decryption instruction, and license verification succeeds.

---

End of file.

