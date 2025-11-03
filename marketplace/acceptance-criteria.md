# Marketplace — Acceptance Criteria

1. Marketplace can list SKUs with metadata and price.
2. Purchase flow returns a signed, encrypted bundle with manifestSignatureId.
3. Delivery pipeline verifies signature and stores audit event.
4. Basic smoke test: purchase -> delivery -> audit event present.
