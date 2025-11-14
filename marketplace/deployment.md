# Marketplace — Deployment & Infra Runbook

Authoritative playbook for standing up the Marketplace module (catalog, preview sandboxes, checkout, licensing, encrypted delivery). Use this to provision infra, wire external systems (Kernel, Finance, Stripe), and operate day‑2.

---

## 1. Responsibilities & architecture
- **Edge/CDN:** Public SPA and asset delivery fronted by CDN/WAF (CloudFront/Fastly) with TLS 1.2+, bot mitigation, and geo filters for export control.
- **Marketplace API:** Stateless backend (Go/Node) that handles SKU CRUD, checkout orchestration, Stripe webhooks, license signing, S3 delivery manifests, and audit fan-out to Kernel.
- **Preview sandbox fleet:** Per-request short-lived environments (K8s namespace or ECS task) network-isolated and tied to SKU TTLs.
- **Background workers:** Delivery packaging, S3 uploads (object-lock bucket), royalty calculation, Stripe webhook retry queue.
- **Data plane:** Postgres for orders/licenses, Redis for session/cache, S3 buckets (artifact delivery + immutable audit bucket with object-lock), optional Elasticsearch/OpenSearch for catalog search.

---

## 2. Core infra components
| Component | Notes |
| --- | --- |
| Kubernetes namespace `illuvrse-marketplace` | Deploy API + workers; use separate node pool for preview sandbox controller if it launches nested workloads. |
| Postgres (managed, HA) | Stores `skus`, `orders`, `licenses`, `delivery_audit`, `preview_sessions`. Enable PITR + daily snapshots. |
| Redis / Memory store | Cache SKU metadata, preview tokens, session data. Enable TLS and AUTH. |
| S3 buckets | `marketplace-artifacts-${env}` for encrypted delivery (SSE-KMS + object-lock) and `marketplace-audit-${env}` for audit exports/logs. |
| Stripe | Payment provider; webhook endpoint exposed via `/marketplace/stripe/webhook` behind WAF allowlist. |
| Finance service | Called to create ledger entries post successful checkout. |
| Kernel | Manifest verification + audit append + license verification keys. |

Preview sandbox controls:
- Sandbox workloads run in dedicated subnets with no east-west access. Use security groups + NetworkPolicies to limit egress to Marketplace API + object storage.
- TTL controller tears down namespaces/VMs once `preview_sessions.expires_at` passes; run hourly garbage collector.

---

## 3. Environment variables & secrets

| Variable | Purpose |
| --- | --- |
| `MARKETPLACE_PORT` | API listen port (default `8085`). |
| `MARKETPLACE_DATABASE_URL` | Postgres DSN with `sslmode=verify-full`. Rotated via Vault. |
| `MARKETPLACE_REDIS_URL` | Redis connection string for cache/session store. |
| `MARKETPLACE_STRIPE_SECRET_KEY` | Stripe API key; stored in Vault and injected as secret. |
| `MARKETPLACE_STRIPE_WEBHOOK_SECRET` | Used to verify webhook signatures. Rotate quarterly. |
| `MARKETPLACE_FINANCE_URL` / `MARKETPLACE_FINANCE_TOKEN` | Finance service endpoint + mTLS/JWT for ledger integration. |
| `MARKETPLACE_KERNEL_URL` / `MARKETPLACE_KERNEL_CERT` / `MARKETPLACE_KERNEL_KEY` | Kernel APIs + mTLS certs for manifest validation + audit emission. |
| `MARKETPLACE_LICENSE_SIGNER_KEY_ID` | KMS key alias for license packages. If using signer proxy expose `MARKETPLACE_SIGNING_ENDPOINT`. |
| `MARKETPLACE_S3_BUCKET` / `MARKETPLACE_S3_KMS_KEY_ID` | Delivery bucket + per-env KMS key. |
| `MARKETPLACE_AUDIT_BUCKET` | Immutable bucket (object-lock) for audit bundles. |
| `MARKETPLACE_PREVIEW_SUBNET_IDS` / `MARKETPLACE_PREVIEW_SECURITY_GROUP` | Where preview sandboxes launch. |
| `MARKETPLACE_ALLOWED_PAYMENT_ORIGINS` | Comma list used for CSP + webhook validation. |
| `MARKETPLACE_SERVICE_ENV` | `dev|staging|prod` influences namespaces, bucket prefixes, metrics labels. |

Secrets are distributed via Vault or Secrets Manager; mount via CSI driver or sealed secrets. All KMS permissions restricted to `kms:Sign`/`kms:GenerateDataKey` for the relevant alias.

---

## 4. Storage, CDN & key management
- **CDN/WAF:** Terminate TLS at CDN, enforce HSTS, implement WAF rules for checkout + license APIs, enable bot mitigation on preview endpoints. Purge CDN cache automatically when SKUs change.
- **S3 artifact bucket:** Enable versioning + Object Lock (compliance mode, 365+ days). Deny unencrypted or public ACL operations. Delivery packages encrypted with per-order data keys: request data key from KMS, encrypt payload client side, upload with metadata referencing key id + manifestSignatureId.
- **Audit bucket:** Use the shared `illuvrse-audit-archive-${env}` bucket (see `infra/audit-archive-bucket.md`). Marketplace writers have `s3:PutObject`, `s3:PutObjectRetention`, and `s3:PutObjectLegalHold` only; deletes require break-glass admin with MFA. Nightly job exports order/license/delivery audit JSON and registers hashes in Kernel. Cross-region replication and lifecycle transitions are inherited from the shared policy.
- **Preview assets:** For ephemeral previews, store base images/container snapshots in a separate bucket with replication to sandbox region.

---

## 5. Database schema & migrations
Canonical tables (to be maintained via `marketplace/sql/migrations` once created):
- `skus` — SKU metadata, manifest signature id, royalty splits, preview template reference.
- `orders` — order status, Stripe session id, finance ledger reference, buyer identity, totals.
- `licenses` — issued licenses, encrypted payload pointers, signer id/signature, expiry, revocation flags.
- `delivery_audit` — log of delivery attempts, encryption key id, S3 object versions, audit hash chain.
- `preview_sessions` — sandbox token, environment id, TTL, usage metrics.

Run migrations before each deploy (Atlas/Flyway example):

```bash
atlas migrate apply --dir marketplace/sql/migrations --url "$MARKETPLACE_DATABASE_URL"
```

Backfill scripts must hash existing deliveries and append to `delivery_audit` to keep audit chain complete.

---

## 6. Deployment workflow
1. **Build artifacts**: compile frontend, build Docker image for API/workers, and attach SBOM (Trivy).
2. **Apply infra IaC**: provision Postgres, Redis, buckets, preview subnets/security groups, IAM roles (least privilege), CDN distribution.
3. **Secrets**: load Stripe/KMS credentials into Vault. Issue short-lived certs for Kernel mTLS.
4. **Migrations**: run database migration job (see §5) and confirm schema version label stored in `schema_migrations`.
5. **Deploy**: Helm upgrade with config/secret references, HorizontalPodAutoscaler (CPU + custom `queue_depth` metric), PodDisruptionBudget, and NetworkPolicies.
6. **Stripe webhooks**: configure webhook endpoint per environment, restrict to CDN/WAF IPs, and enforce signature validation.
7. **Smoke tests**: synthetic checkout (test mode), preview sandbox creation/teardown, license issuance/verification hitting Kernel + Finance sandbox.
8. **Observability**: scrape `/metrics` (latency, preview queue depth, delivery success), ship logs to SIEM, configure alerts (Stripe webhook failures, preview capacity, delivery retries).

---

## 7. Security & compliance controls
- mTLS between Marketplace ↔ Kernel and Marketplace ↔ Finance. Humans authenticate via OIDC/OAuth with MFA.
- PCI scope limited to Stripe-hosted payment pages; Marketplace never stores PAN. Use Stripe Elements or Checkout.
- Delivery keys: license payloads are signed via KMS and encrypted with a per-order data key; store wrapped data key + key id in `licenses.metadata`.
- Preview network: sandboxes use egress-only internet gateway; no inbound paths except via bastion. Use PodSecurityPolicies/OPA to block privileged containers.
- Audit: every order/preview/delivery writes to Kernel audit log + S3 audit bucket with object-lock; nightly job verifies hash chain.

---

## 8. Runbooks
1. **Stripe webhook failures**  
   - Alert when `stripe_webhook_failures_total` spikes. Check CDN/WAF logs for dropped requests, verify webhook secret matches Stripe dashboard, replay events via Stripe CLI, and inspect dead-letter queue. If Stripe unreachable, queue events in durable store and replay once healthy.  
2. **Preview sandbox leak/compromise**  
   - Immediately revoke preview token (`preview_sessions.revoked=true`), tear down namespace/task, rotate sandbox base image, and scan for exfil in VPC flow logs. Run audit to ensure TTL controller functioning; increase cadence if stale environments remain.  
3. **Delivery encryption failure**  
   - If license verification fails or payload cannot decrypt, suspend fulfillment, verify KMS grants, reissue per-order data key, regenerate package, and append new audit event referencing superseded package. Confirm S3 object-lock prevents tampering and notify affected buyers.  
4. **Finance integration outage**  
   - Flip Marketplace into degraded mode: accept payments but hold deliveries until Finance ledger call succeeds. Queue ledger payloads in `orders.deferred_finance_payload`. Once Finance recovers, replay queue, compare order totals vs Finance journal, then release held deliveries.  
5. **Kernel manifest verification failure**  
   - If Kernel rejects SKU manifest, block SKU activation, notify content ops, and re-run manifest signing. Audit ensures no SKU goes live without valid signature.
6. **Audit archive restore drill (quarterly)**  
   - Select an archived delivery/audit object, restore from Glacier if necessary, compute checksum + signature, and replay the bundle into staging (Marketplace + Memory Layer) to prove end-to-end recovery. Document the drill in the DR log; failures escalate to Security + Infra immediately.

---

## 9. Deployment checklist
- [ ] CDN/WAF + TLS certs deployed; HSTS & geo rules enabled.
- [ ] Postgres + Redis provisioned with backups + monitoring.
- [ ] S3 buckets created with SSE-KMS + object-lock; IAM policies deny unapproved principals.
- [ ] Stripe keys & webhook secrets stored in Vault; webhooks configured per environment.
- [ ] Finance + Kernel endpoints reachable via mTLS.
- [ ] Preview sandbox controller configured with TTL + network isolation.
- [ ] DB migrations applied and schema hash recorded.
- [ ] Synthetic checkout + delivery test passes and audit events observed in Kernel + S3.
