# Marketplace & Delivery — Core Module

## # Purpose
This directory contains the Marketplace & Delivery artifacts for ILLUVRSE: catalog, preview/sandbox, checkout, license issuance, encrypted delivery, royalties, and audit integration. The Marketplace is the customer-facing surface for distributing signed SKUs and the operational surface for delivering and settling purchases.

## # Location
All files for the Marketplace live under:
~/ILLUVRSE/Main/marketplace/

## # Files in this module
- `marketplace-spec.md` — core specification (already present).
- `README.md` — this file.
- `deployment.md` — deployment & infra guidance (to be created).
- `api.md` — API surface and examples (to be created).
- `acceptance-criteria.md` — testable checks for the Marketplace (to be created).
- `.gitignore` — local ignores for runtime files (to be created).

## # How to use this module
1. Read `marketplace-spec.md` to understand SKUs, licenses, delivery, previews, finance interactions, and audit obligations.
2. Implement the Marketplace service to follow the checkout → payment → finance → license → delivery flow. Ensure every step emits an AuditEvent linked to signed manifests and artifacts.
3. Integrate Sandboxes with strict network and resource isolation and ensure previews are time-limited and audited.
4. Integrate SentinelNet for policy checks on listings and purchases (fraud, export control, PII).
5. Use Finance for ledger entries, royalty splits, and payout orchestration; do not perform financial settlement outside Finance’s confirmed flows.

## # Security & compliance
- Use a PCI-compliant payment provider (Stripe); do not store card data.
- Sign every SKU and delivery artifact with Kernel signer or owner signer; store ManifestSignature references.
- Encrypted delivery should use buyer-key or HSM-managed ephemeral keys; keys must be short-lived and auditable.
- Respect regional export controls and geofencing; block delivery where jurisdiction forbids.

## # Audit & immutability
- All order, payment, license, delivery, refund, and transfer events must be audit-logged (hash + signature) per the Audit Log Spec.
- Artifact checksums and signed manifests must be stored in S3 with object-lock enabled for audited buckets.

## # Acceptance & sign-off
Marketplace is accepted when:
- End-to-end checkout → payment → finance → license → delivery flow works and is audited.
- License verification endpoint validates signatures and ownership.
- Preview sandboxes operate securely and are audited.
- Royalties and payout flows are validated with Finance.
Final approver: **Ryan (SuperAdmin)**. Security Engineer and Finance must review payment and settlement integrations.

## # Next single step
Create `deployment.md` for the Marketplace (one file). When you’re ready, reply **“next”** and I’ll give the exact content for that single file.

---

End of README.

