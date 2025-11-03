# Market & Media — Deployment & Infrastructure Guide

Purpose: production-ready operational guidance for deploying Market & Media services (asset store, campaign orchestration, publishing pipelines, analytics ingestion, creator programs). Focus on secure publishing, auditable spend, low-latency analytics, compliance, and cost control.

---

# # 1) High-level architecture
- **Media API & UI** — stateless backend + admin UI for editors, campaign managers, and creators.
- **Campaign Orchestrator** — workflow engine orchestrating campaign lifecycles, creative scheduling, budget allocation, and reconciliation.
- **Asset Store** — S3-backed store for assets with metadata in Postgres and integration for signed URLs and content publishing.
- **Analytics Pipeline** — event ingestion (Kafka), stream processing for attribution, and materialized analytics store (Clickhouse/BigQuery) for fast queries.
- **Creator & Royalty Service** — manages creators, royalty rules, contract refs, and hands off payouts to Finance.
- **Moderation & Policy** — SentinelNet integration for automated pre-publish and runtime checks; CommandPad for human review and overrides.
- **Audit & Eventing** — Kafka/Redpanda for events, Kernel audit bus for immutable audit records, and S3 for audit archives.

---

# # 2) Required infrastructure & providers
- **Kubernetes** for APIs, workers, and sandboxed publishers. Use managed clusters for production.
- **Managed Postgres** for authoritative product/campaign/asset metadata.
- **Object storage (S3/GCS/MinIO)** for assets and legal artifacts. Enable versioning and object lock for audit buckets.
- **High-performance analytics store** (ClickHouse / BigQuery / Snowflake) for campaign/attribution queries.
- **Kafka/Redpanda** for eventing and streaming telemetry.
- **Redis** for caches and fast counts (optional).
- **KMS/HSM & Vault** for signing, encryption keys, and secrets.
- **CDN** for published assets and landing pages.
- **Monitoring & tracing**: Prometheus/Grafana and OpenTelemetry/Jaeger.
- **CI/CD & GitOps**: GitHub Actions + ArgoCD/Flux for deployments.

---

# # 3) Kubernetes deployment patterns
- **Namespaces**: `market-media-api`, `market-media-workers`, `market-media-admin`.
- **Helm charts**: Deploy API, orchestrator, ingestion workers, moderation workers, and admin UI via Helm. Include ConfigMaps for channel configs and NetworkPolicies for restricted egress.
- **Replica & HPA**: API min 2 replicas; workers autoscale on queue/backlog metrics.
- **Pod security**: non-root, minimal capabilities, no hostPath mounts; enforce Pod Security admission. Use NetworkPolicies to restrict access to infra services.

---

# # 4) Asset lifecycle & storage
- **Upload flow**: client uploads to a signed S3 URL; backend records metadata in Postgres and emits an audit event.
- **Signed delivery**: published assets served via CDN with signed URLs or signed download tokens for direct downloads. For encrypted deliveries, store encrypted blobs and handle key retrieval securely.
- **Immutability & legal hold**: enable object lock for audit/legal buckets. Provide legal-hold flags for long-term retention.
- **Transcoding & thumbnails**: run workers (K8s jobs) for transcoding; store derivatives as separate artifact records.

---

# # 5) Campaign orchestration & budgets
- **Workflow engine**: use Temporal or durable workflows for campaign orchestration (create → approvals → start → monitor → stop → reconcile). Durable workflows simplify retries and manual approvals.
- **Budget reservation**: request budget via Kernel/Resource Allocator; Finance confirmation required before distribution of paid media.
- **Channel adapters**: build connectors for ad platforms (Facebook, Google, X/Twitter, LinkedIn) and social platforms; perform rate-limited API calls and robust webhook handling.
- **Creative scheduling**: orchestrate creative publishing across channels and maintain publishes' audit trail.

---

# # 6) Analytics & attribution
- **Event ingestion**: publish canonical analytics events to Kafka (impression, click, conversion, attribution). Use idempotency keys for duplicate suppression.
- **Stream processing**: use stream processors (ksql/beam/flink) or worker jobs to compute attribution, cohort metrics, and update materialized views in ClickHouse/BigQuery.
- **Attribution model**: support last-click and configurable multi-touch attribution; store raw events for reprocessing.
- **Realtime dashboards**: expose near-realtime campaign dashboards for owners.

---

# # 7) Moderation & SentinelNet
- **Pre-publish checks**: before publishing, run SentinelNet scans to detect PII, copyright, defamation, or policy violations. Block or quarantine as required.
- **Human moderation**: flagged items are routed to CommandPad for review/override; moderation actions emit audit events.
- **Runtime moderation**: monitor social posts/feeds for violations and support takedown flows with audit records.

---

# # 8) Creator & royalties integration
- **Creator onboarding**: store contract refs and royalty rules; perform KYC if required (pointer to KYC evidence).
- **Royalty tracking**: record revenue share per asset/SKU and provide periodic payout batches to Finance.
- **Content rights**: ensure assets have license metadata and that expiry triggers takedown/renewal workflows.

---

# # 9) Security & compliance
- **mTLS & RBAC**: internal services use mTLS; admin UI uses OIDC/SSO with 2FA. Roles for Editor, CampaignManager, CreatorAdmin, FinanceViewer.
- **PII controls**: store PII only as pointers to secure services; require SentinelNet + Legal sign-off before any PII-exposing publish.
- **Signing & provenance**: important publishes (paid placements, creative bundles) recorded with ManifestSignature and emitted to Kernel audit bus.
- **Network & secrets**: restrict egress to required platform APIs; secrets via Vault and rotated regularly.

---

# # 10) Observability & SLOs
- **Metrics**: asset upload latency, publish latency, campaign start-to-live time, impressions/sec ingestion, attribution pipeline lag, campaign spend reconciliation lag.
- **Tracing**: end-to-end traces from publish → ad platform API → webhook → attribution.
- **Alerts**: ingestion backlogs, high publish failure rates, campaign vs Finance spend mismatches, SentinelNet blocks.
- **SLO examples**: publish p95 < 2s for small assets (post-transcoding caveat), attribution pipeline latency p95 < 60s for near-realtime.

---

# # 11) Backups, DR & retention
- **Postgres & backups**: managed Postgres with PITR and daily snapshots.
- **S3**: versioning and object lock for audit buckets. Archive older assets to cold storage.
- **Analytics export**: raw events archived for 7+ years per policy; allow reprocessing for audits.
- **DR drills**: periodically restore Postgres and replay analytics events to validate pipeline.

---

# # 12) CI/CD & testing
- **Pipeline**: unit tests → contract tests for channel adapters → staging deploy → integration tests with mock ad platforms → smoke & acceptance tests → canary.
- **Policy tests**: SentinelNet integration tests to ensure posts blocked when needed.
- **Load & chaos**: test publishing spikes and CDN/analytics stress; simulate ad platform outages and webhook duplications.

---

# # 13) Runbooks (must exist)
- Publish failure & retry runbook.
- Campaign spend reconciliation runbook.
- Moderation incident response runbook (takedown and appeal).
- KYC provider outage (creator onboarding) runbook.
- Analytics pipeline backfill & replay runbook.

---

# # 14) Acceptance criteria (deployment)
- **Asset flows**: upload → review → SentinelNet pass → publish → CDN delivery and audit event emitted.
- **Campaign flows**: create campaign → reserve budget via Kernel → start → collect metrics → stop → reconcile with Finance.
- **Analytics**: events ingested → attribution computed → dashboards updated; reprocess raw events successfully.
- **Moderation**: SentinelNet blocks disallowed publish and CommandPad override recorded with audit.
- **Creator payouts**: royalty calculation and payout batches integrate with Finance and produce audit records.
- **Security**: PII-blocked or legal-required publishes fail until approval; signing and audit linked to publishes.

---

# # 15) Operational notes & cost controls
- Use CDNs to serve published assets and reduce origin costs.
- Throttle preview and publishing jobs to avoid rate-limited platform API calls.
- Monitor ad platform costs and set hard spend limits for campaigns; require multisig for large increases.
- Keep moderation actions auditable and provide clear UX for appeals and legal review.

---

End of file.

