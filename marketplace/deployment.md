# Marketplace — Deployment

## Components
- Web frontend + backend, CDN for assets.
- S3 for artifacts and encrypted delivery, with object-lock for audit buckets.
- Stripe integration (webhooks) secured with signature verification.
- Finance service integration.

## Security
- Use Stripe's best practices and not store PAN. Use ready PCI SAQ flows.
- Delivery key management with KMS/HSM and ephemeral keys.

