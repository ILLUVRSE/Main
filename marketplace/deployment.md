# Marketplace — Deployment & Infrastructure Guide

Purpose: operational, production-ready instructions for deploying the Marketplace & Delivery system. This doc covers recommended infra, deployment patterns, security and compliance controls (payments, encryption, licenses), scaling, observability, backups, and runbooks.

---

## 1) High-level architecture
- **Marketplace API & UI**: stateless services (frontend + backend) deployed to Kubernetes; backend handles catalog, orders, license issuance, and delivery orchestration.  
- **Checkout & Payments**: integrate with a managed payment provider (Stripe recommended). Use webhooks for confirmation and avoid storing card data.  
- **Delivery & Artifacts**: store signed artifacts in S3 (or S3-compatible). For encrypted delivery, store encrypted blobs and short-lived keys in KMS or deliver via buyer public-key.  
- **License Registry**: Postgres (managed) as authoritative store for SKUs, orders, licenses, and delivery records.  
- **Eventing & Audit**: Kafka/Redpanda for event streaming (orders, deliveries); audit events archived to S3 with object lock.  
- **Sandbox infrastructure**: Kubernetes namespaces or ephemeral clusters for live previews, isolated per-preview with strict network controls.  
- **Finance integration**: Finance service for ledger entries, royalty calculations, and payouts. Marketplace interacts with Finance for reconciliation.  
- **SentinelNet**: policy checks for listing and purchases, fraud detection, and export-control enforcement.

---

## 2) Required infrastructure & providers
- **Kubernetes cluster** for API, UI, and sandbox controllers. Use multi-AZ production clusters.  
- **Managed Postgres** for catalog, orders, license registry, and reporting.  
- **S3-compatible storage** for artifacts, signed bundles, audit archive (enable versioning and object lock).  
- **Kafka/Redpanda** for reliable event streaming.  
- **Stripe (or other PCI-compliant provider)** for payments; use hosted checkout or payment intents.  
- **KMS/HSM** for encryption key management and signing (or a signing proxy to HSM).  
- **Vault / Secrets Manager** for dynamic secrets and service credentials.  
- **Redis** for caching and rate-limiting (optional).  
- **Monitoring & tracing**: Prometheus, Grafana, and OpenTelemetry/Jaeger.  
- **CI/CD / GitOps**: GitHub Actions + ArgoCD / Flux for automated deployments and canaries.

---

## 3) Kubernetes deployment patterns
- **Namespace**: `illuvrse-marketplace` for core services and ephemeral namespaces for sandboxes.  
- **Helm chart**: include Deployments, Services, Ingress, ConfigMaps, Secrets (sourced from Vault), HPA, and PodDisruptionBudget.  
- **Stateless services**: design Marketplace API as stateless; persistent state in Postgres and S3.  
- **Init jobs**: DB migrations run as pre-deploy jobs.  
- **Canary & blue/green**: use canary deployments for releases and smoke tests before full rollout.

---

## 4) Payments & finance integration
- **Stripe usage**: use PaymentIntents and hosted Checkout where feasible; handle webhooks securely (verify signatures).  
- **Reconciliation**: on payment success webhook, Marketplace creates an order, emits audit event, and calls Finance to create ledger entry before license issuance. Do not issue licenses until Finance acknowledges.  
- **PCI compliance**: Marketplace must not store raw card data. Use provider tokens. Ensure webhook endpoints are authenticated and protected.  
- **Refunds & disputes**: integrate refund flows with Finance; refunds trigger license revocation and audit events. Prepare for chargeback workflows and reconciliation.

---

## 5) Delivery & encryption
- **Signed artifacts**: all bundles must be signed (Ed25519) with signerId and manifest information recorded. Store signature metadata with the artifact.  
- **Encrypted delivery options**:
  - **Buyer public-key**: encrypt bundle to buyer public key — preferred for maximum security.  
  - **Ephemeral keys**: generate short-lived symmetric keys in KMS and provide decryption instructions after successful payment. Keys must be auditable and ephemeral.  
- **Download URLs**: provide time-limited signed URLs (S3 presigned) with short TTL. For encrypted bundles, include instructions for key retrieval or provide decryption helper in client.  
- **License issuance**: create signed license JSON and include licenseId and signature in delivery payload. License verification endpoint must validate signature and ownership.

---

## 6) Sandbox & preview infrastructure
- **Ephemeral sandboxes**: create ephemeral sandbox pods or lightweight clusters for live previews. Enforce strict network egress policies, CPU/memory quotas, and expiration timers.  
- **Resource control**: limit per-preview time (e.g., 10–30 minutes) and per-user concurrent sandboxes. Chargeable previews should reserve compute.  
- **Security**: sandbox containers must be isolated (NetworkPolicies), mount minimal volumes, and have no direct access to production secrets. Instrument for telemetry and audit actions in preview.

---

## 7) Security & governance
- **Manifest signing**: require SKU manifests and delivery manifests to be signed. Validate signatures before publication or delivery.  
- **mTLS and RBAC**: internal services communicate via mTLS; map identities to roles. Admin UI uses OIDC/SSO with 2FA.  
- **KMS & signing**: use KMS/HSM for key management; do not store private keys in cluster secrets.  
- **SentinelNet checks**: scan new listings and purchases for policy violations and block/flag as required.  
- **PII & legal compliance**: minimize buyer PII in Marketplace DB; use Finance for payment-sensitive data and ensure GDPR workflows are available.

---

## 8) Observability & SLOs
- **Metrics**: orders/sec, checkout latency, payment processing time, delivery latency (time from payment confirmation to license issuance), sandbox creation time, preview failures, refund rate.  
- **Tracing**: full trace from buyer action → payment → finance → license issuance → delivery.  
- **Dashboards & alerts**: alerts for failed webhooks, high refund/chargeback rate, sandbox abuse, and audit pipeline lag.  
- **SLO examples**: checkout p95 < 500ms (API), delivery median < X seconds (depends on Finance confirmation), sandbox provisioning median < Y seconds.

---

## 9) Backups & DR
- **Postgres**: daily snapshots + WAL archiving for PITR; cross-region replication for critical availability.  
- **S3**: enable versioning and immutable object lock for audit buckets. Archive audit topics daily.  
- **Kafka**: ensure retention and mirror critical topics. Archive to S3 for long-term storage.  
- **DR drills**: periodic restore tests for Postgres and S3 artifacts to validate recovery.

---

## 10) CI/CD & deployments
- **Pipeline**: lint + unit tests → build image → security scan → integration tests with mocked payment provider → deploy to staging → run acceptance tests → canary → production rollout.  
- **Feature flags**: gate new pricing or delivery features behind flags during rollout.  
- **Multi-sig gating**: major changes to pricing models, payment flow, or license model require multi-sig per governance.

---

## 11) Monitoring & fraud detection
- **Fraud signals**: high-order velocity from a single IP, multiple failed payment attempts, suspicious sandbox usage, purchase patterns inconsistent with historical behavior. Route these signals to SentinelNet for real-time blocking.  
- **Manual review queue**: create an operator UI for flagged purchases requiring manual review or ratification. All manual actions must be audited.

---

## 12) Scaling & capacity
- **Stateless scaling**: Marketplace API scale horizontally; use autoscaling for frontend and backend.  
- **Sandbox scale**: autoscale sandbox controllers and node pools; throttle previews based on capacity.  
- **S3 & artifact throughput**: monitor and plan for spike traffic at popular launches. Use CDNs for static assets as appropriate.

---

## 13) Runbooks (must exist)
- Payment webhook failure & retry runbook.  
- License revocation & refund runbook.  
- Sandbox abuse & isolation runbook.  
- Artifact integrity verification & replay runbook.  
- Key compromise & rotation runbook.

---

## 14) Acceptance criteria (deployment)
- Marketplace services deploy successfully to staging and pass health checks.  
- End-to-end checkout flow: create order → payment confirmation via webhook → Finance reconciliation → signed license issuance and delivery.  
- Sandbox provisioning: preview URL created, sandbox isolated, and expires as expected.  
- License verification endpoint validates license signatures and ownership.  
- Audit trail: orders, payments, license issuance, deliveries, refunds produce AuditEvents and archived correctly.  
- SentinelNet blocks a policy-violating SKU or purchase during staged tests.  
- Monitoring, tracing, and alerts configured and operational.

---

## 15) Operational notes & cost controls
- Use managed payment provider for PCI compliance.  
- Cost controls: enforce quotas for previews; schedule heavy operations (large bundling jobs) in off-peak windows.  
- Royalties and payouts: batch payouts and reconcile with Finance off-chain to reduce cost and complexity.  
- Keep artifact sizes small when possible; host large media assets on CDN.

---

End of file.

