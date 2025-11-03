# Market & Media — Specification

## # Purpose
Operate audience growth, content production, and distribution for ILLUVRSE. Run marketing campaigns, content pipelines, SEO/social/media, analytics, and creator programs — all governed, auditable, and integrated with Kernel, Marketplace, and Product teams. Provide mechanisms to plan, execute, measure, and optimize growth channels and creative assets.

---

## # Core responsibilities
- Content production pipeline: plan, create, review, publish, and archive articles, videos, social posts, and assets.
- Campaign orchestration: design and run multiplatform campaigns (organic + paid), manage budgets, creatives, audiences, and measurement.
- Creator/partner programs: onboard creators, manage assets, royalties, and distribution agreements.
- SEO & discoverability: manage site SEO, sitemaps, structured data, and performance for marketplace and product pages.
- Social & community: run social channels, community engagement, and moderation integration with SentinelNet.
- Analytics & attribution: instrument funnels, measure CAC/LTV, run cohort analysis, and attribution across channels.
- Content licensing & rights: track asset rights, licenses, expirations, and royalties (integrate with Finance).
- Growth experiments: A/B tests for landing pages, creatives, CTAs, and distribution strategies; track and report results.

---

## # Minimal public APIs (intents)
These endpoints are internally consumed by Product, Marketplace, Kernel, and external publishing hooks:

- `POST /media/asset` — register/upload a media asset (metadata, owner, license, tags). Returns `assetId`.
- `GET  /media/asset/{id}` — fetch asset metadata and signed download/publish URL.
- `POST /media/campaign` — create campaign (name, channels, budget, creatives[]). Returns `campaignId`.
- `POST /media/campaign/{id}/start` — start campaign (allocates budget, triggers creative distribution).
- `GET  /media/campaign/{id}/metrics` — fetch campaign metrics (impressions, clicks, conversions, cost).
- `POST /media/publish/{assetId}` — schedule or publish an asset to a channel (web, social, newsletter).
- `POST /media/seo/sitemap` — submit/update sitemap entries and OG/structured-data metadata for pages.
- `POST /media/creator/register` — register creator/partner with contract & royalty rules.
- `POST /media/analytics/event` — ingest analytics events (pageview, conversion, attribution).
- `GET  /media/report/{id}` — generate campaign/creative/creator report for a period.

**Notes:** Publishing actions should emit AuditEvents; SentinelNet checks for policy violations prior to publishing (e.g., copyright or PII).

---

## # Canonical models (short)

## # MediaAsset
- `assetId`, `title`, `ownerId`, `type` (`image|video|article|audio`), `tags`, `licenseId`, `status` (`draft|review|approved|published|retired`), `metadata`, `createdAt`.

## # Campaign
- `campaignId`, `name`, `channels` (list), `budget`, `currency`, `creatives` (assetIds), `startDate`, `endDate`, `targeting`, `status`, `metricsSnapshot`.

## # Creator
- `creatorId`, `name`, `contractRef`, `royaltyRules`, `status`, `kycEvidenceRef` (if needed), `createdAt`.

## # AnalyticsEvent
- `eventId`, `eventType` (pageview, click, conversion), `actor` (userId or anon), `context` (campaignId/productId), `ts`.

---

## # Processes & rules

## # Content production
- Create → Review → Legal/Compliance check (SentinelNet/legal as needed) → Sign-off → Publish → Distribute.
- All approvals and legal checks produce audit records. Rights and license metadata must be attached before publish.

## # Campaign lifecycle
1. Plan: define objectives, creatives, audiences, and budget.
2. Build: link creatives (MediaAssets) and targeting.
3. Approvals: creative review, legal, and budget sign-off.
4. Start: allocate budget via Kernel/Resource Allocator; start distribution.
5. Measure & iterate: collect analytics events, attribute conversions, optimize creatives/audience, record learnings.
6. Close & reconcile: stop campaign, reconcile spend with Finance, archive creatives and data.

## # Attribution & analytics
- Instrument canonical events: impression, click, conversion, sign-up, payment. Use consistent identifiers for campaign and creative attribution.
- Maintain attribution windows and support multi-touch models; store raw events for reprocessing.
- Feed experiment/campaign metrics into Eval Engine and Product reasoning graph for cross-product scoring.

## # Creator program & royalties
- Creators register and sign contracts; royalty rules attached to assets or SKUs.
- Marketplace integrates for sales; Finance executes payouts per royalty rules.
- Track creator performance metrics and reward/bonus programs.

---

## # Integrations & tooling
- **Kernel:** audit events, multisig budget approvals, and manifest signing for published bundles or campaign budgets.
- **SentinelNet:** pre-publish content scanning for copyright/PII/brand compliance and real-time moderation.
- **Memory Layer:** store transcripts, scripts, and produced content metadata for search and reuse.
- **Marketplace:** cross-listing of promos, featured SKUs, and creative assets.
- **Finance:** campaign budget reservations, spend reconciliation, creator payouts, and royalty accounting.
- **Product & AI infra:** creative generation, personalization models, and A/B experiment support.

---

## # SEO, publication & moderation
- Generate canonical pages with correct OG tags, structured data, and sitemaps. Submit sitemaps to search engines via automated processes.
- Integrate moderation pipeline: automated checks (SentinelNet) + human moderation workflow (CommandPad) for appeals and overrides.
- Maintain publication schedule and ensure expired content or license expirations trigger takedown or review.

---

## # Metrics & success criteria
- **Acquisition metrics:** impressions, clicks, CTR, conversions, CAC.
- **Activation metrics:** activation rate resulting from campaigns or content.
- **Engagement:** session duration, pages per session, return visits.
- **Creator metrics:** revenue per creator, engagement lift, churn.
- **Operational:** campaign velocity, cost per campaign setup, publication latency.

---

## # Safety & compliance
- Use SentinelNet to scan content for PII, copyright, brand violations, and policy compliance. Block or quarantine flagged content until review.
- Licensing and rights must be validated before publication; Marketplace listings must include license metadata.
- Regional restrictions: enforce geoblocking and content restrictions per jurisdiction.

---

## # Acceptance criteria (minimal)
- Media asset registration and publishing flow works: upload asset → legal/compliance checks → approve → publish to channel with audit event.
- Campaign lifecycle works end-to-end: create → allocate budget (via Kernel) → start → collect metrics → stop → reconcile spend with Finance.
- Analytics ingestion works and campaign attribution is consistent and queryable.
- Creator registration and royalty pipeline integrated with Finance for payouts.
- SentinelNet blocks a policy-violating publish and produces a `policyCheck` audit event.
- SEO/sitemap generation and submission for new/updated pages functions and is auditable.

---

## # Operational notes
- Keep content and campaign templates to speed repeatable launches.
- Automate as much of legal/compliance checking as safe — use SentinelNet and then human review for edge cases.
- Create dashboards for campaign owners and finance for spend reconciliation.

---

End of file.

