# Marketplace — Acceptance Criteria

Ensure Marketplace can list, preview, sell and deliver Kernel-signed SKUs with full auditability.

## # 1) Listing & verification
- Marketplace validates manifestSignatureId for every SKU prior to listing.

## # 2) Checkout & payment
- Checkout → Stripe → Finance ledger entry → license issuance flow completes and is auditable.

## # 3) Preview sandbox
- Preview sandboxes are time-limited, network-limited, and produce audit trail.

## # 4) Delivery
- Encrypted delivery with short-lived keys; buyer receives key and artifact; license verification endpoint validates signature.

## # 5) Royalties & payouts
- Royalties split recorded in Finance and audit events stored.

## # # Test
- E2E: list signed SKU → preview → checkout → delivery → license verification → finance ledger proof.

