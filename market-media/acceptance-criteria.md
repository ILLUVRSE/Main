# Market & Media — Acceptance Criteria

Purpose: concise, testable checks proving the Market & Media module is correct, auditable, secure, and production-ready. Each item is actionable and verifiable.

---

# # 1) Asset registration & publishing
- **Requirement:** Upload a media asset, run compliance checks, approve, and publish to a channel. Publishing emits an AuditEvent and generates a CDN-signed URL (or scheduled publish).
- **How to verify:** Upload sample asset, run SentinelNet pre-publish scan, approve in CommandPad, publish, and confirm CDN URL works and an AuditEvent with ManifestSignature (if applicable) exists.

# # 2) Campaign lifecycle & budget integration
- **Requirement:** Create a campaign, reserve budget via Kernel/Finance, start campaign, collect metrics, stop campaign, and reconcile spend with Finance. Campaign start should be blocked if Finance reservation fails or SentinelNet rejects.
- **How to verify:** Create campaign with budget, request reservation, simulate Finance approval → start campaign → simulate ad impressions and conversions → stop campaign → run reconciliation and confirm ledger entries and audit events.

# # 3) Analytics & attribution
- **Requirement:** Ingest analytics events (impression, click, conversion), compute attribution for a campaign, and expose queryable metrics (CTR, conversions, CAC).
- **How to verify:** Emit synthetic events for a campaign and verify attribution results match expected attribution model; query dashboards or materialized views and confirm metrics.

# # 4) Moderation & SentinelNet enforcement
- **Requirement:** Pre-publish and runtime moderation via SentinelNet works: policy-violating content is blocked/quarantined and `policyCheck` events recorded. Human moderation flows allow review and override with audit trail.
- **How to verify:** Create an asset with simulated policy violation (PII/copyright), attempt to publish, confirm block and `policyCheck`, review in CommandPad and perform approved override (audit recorded).

# # 5) Creator onboarding & royalties
- **Requirement:** Register a creator, record contract/royalty rules, associate assets, and compute royalties for sales or campaign-derived payouts. Payout requests are forwarded to Finance.
- **How to verify:** Register creator with royalty rule, simulate sales or campaign revenue, generate royalty report, and confirm payout batch created for Finance with correct accounting and audit events.

# # 6) SEO / sitemap / page publication
- **Requirement:** Generate sitemap and OG/structured-data metadata for published pages; sitemaps submitted and reflect published assets/pages.
- **How to verify:** Publish page/asset, verify sitemap updated, check OG tags on page, and confirm sitemap submission log exists and is auditable.

# # 7) Edge cases & reliability
- **Requirement:** Webhook duplicates or ad platform retries do not double-count impressions/conversions (idempotency). Publishing retries and CDN edge failures recover gracefully.
- **How to verify:** Replay the same webhook twice and confirm single attribution; simulate CDN origin failure and verify graceful retries or fallbacks.

# # 8) Security & PII controls
- **Requirement:** PII is not stored in clear in Market & Media DB; SentinelNet blocks PII-containing publishes unless approved. Access to PII evidence is restricted and audited.
- **How to verify:** Attempt to publish PII content without SentinelNet/legal approval and confirm block. Confirm evidence pointers exist but raw PII is not in DB. Attempt unauthorized access and confirm denial.

# # 9) Audit & immutability
- **Requirement:** Every publish, campaign budget change, approval, moderation action, and payout request emits an AuditEvent with provable hash/signature per the Audit Log Spec.
- **How to verify:** Run a full campaign publish flow and confirm corresponding AuditEvents exist in the audit sink and verify their hash/signatures.

# # 10) Observability & SLOs
- **Requirement:** Export metrics: publish latency, campaign start-to-live, attribution pipeline lag, ingestion rate, reconciliation lag. Alerts configured for backlogs and publish failures.
- **How to verify:** Check Prometheus/Grafana dashboards, run a publish + campaign scenario, and confirm metrics appear; simulate pipeline lag and confirm alert triggers.

# # 11) Backups & replay
- **Requirement:** Raw analytics events and published asset metadata are archived to S3 for retention and reprocessing; replaying archived events reconstructs attribution state for audits.
- **How to verify:** Archive a day's events, restore to staging, re-run attribution, and confirm results align with production runs.

# # 12) Tests & automation
- **Requirement:** Unit tests for core logic; integration tests for campaign orchestration and publishing flows; contract tests for channel adapters. Dev/CI runs policy simulations to detect regressions.
- **How to verify:** Run CI; ensure unit/integration tests pass; run end-to-end campaign acceptance tests in staging.

# # 13) Documentation & sign-off
- **Requirement:** `market-media-spec.md`, `deployment.md`, `README.md`, and this acceptance file exist and are reviewed. Security Engineer, Legal, Finance, and Ryan sign off on policies and payout flows.
- **How to verify:** Confirm files present and obtain written sign-off recorded as an AuditEvent.

---

# # Final acceptance statement
Market & Media is accepted when all above criteria pass in a staging environment, automated tests are green, SentinelNet policies prevent disallowed publishes, Finance reconciliation works for campaign spend and creator payouts, and formal sign-off by Security, Legal, Finance, and Ryan is recorded.


