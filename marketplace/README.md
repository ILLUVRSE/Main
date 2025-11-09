# Marketplace & Delivery — Core Module

## # Purpose
The Marketplace is the customer-facing surface for distributing signed SKUs: catalog, preview/sandbox, checkout, license issuance, encrypted delivery, and royalties. It must integrate with Kernel for manifest verification and with Finance for ledgered settlement.

## # Location
All files for the Marketplace live under:
`~/ILLUVRSE/Main/marketplace/`

## # Files in this module
- `marketplace-spec.md` — core specification (already present).  
- `README.md` — this file.  
- `deployment.md` — deployment & infra guidance (to be created).  
- `api.md` — API surface and examples (to be created).  
- `acceptance-criteria.md` — testable checks for the Marketplace (to be created).

## # How to use this module
1. Read `marketplace-spec.md` to understand SKUs, preview sandboxes, checkout flows, license formats, DRM and audit obligations.  
2. Implement Marketplace flow that:
   * Validates SKU artifacts and their Kernel-signed manifest before listing.  
   * Provides secure preview sandboxes that are time-limited and auditable.  
   * Integrates with payment provider (Stripe) for payments and Finance for ledger entries and royalty splits.  
   * Issues licenses and delivery artifacts signed/anchored to Kernel manifests.  
   * Uses buyer key or HSM-managed ephemeral keys for encrypted delivery and records delivery audit events.

## # Security & compliance
- Use a PCI-compliant payment provider (Stripe) and do not store raw card data.  
- Sign every SKU and delivery artifact (Kernel signer or owner signer) and store manifestSignatureId.  
- Encrypted delivery should use short-lived buyer keys or HSM-managed ephemeral keys; record key provenance.  
- Enforce export control and jurisdictional geofencing.

## # Audit & immutability
- All order, payment, license, delivery, refund, and transfer events must be audit-logged (hash + signature) and link to signed manifests.  
- Artifact checksums and signed manifests must be stored in S3 with object-lock enabled for audit buckets.

## # Acceptance & sign-off
Marketplace is accepted when:
* End-to-end checkout → payment → finance → license → delivery flow is implemented and audited.  
* License verification endpoint validates signatures and ownership.  
* Preview sandboxes operate securely and are auditable.  
* Royalties and payout flows validate with Finance.

Final approver: **Ryan (SuperAdmin)**. Security and Finance must sign off on payment and settlement integrations.

## # Next single step
Create `deployment.md` for Marketplace (one file) with CDN and delivery key management guidance, S3 bucket policies, and preview sandbox network controls. When ready, reply **“next-marketplace”** and I’ll provide the exact content for that file.

