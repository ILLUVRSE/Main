# Business & Product Development — Specification

## Purpose
Incubate, validate, and launch new AI-native products and startups inside ILLUVRSE. Run repeatable discovery → build → measure → scale cycles, own product-market fit, acquisition experiments, early monetization, and handoff to operations. Provide APIs and artifacts to Kernel, Market & Media, Finance, and AI infra so incubation is auditable, measurable, and governed.

---

## Core responsibilities
- Idea pipeline: capture, score and prioritize product blueprints and hypotheses.  
- Discovery & research: run customer interviews, prototypes, usability tests, and capture evidence (notes, recordings, metrics).  
- Roadmaps & sprints: own a repeatable delivery cadence, milestones, and go/no-go gates.  
- MVP delivery: produce minimal, measurable product increments with tracking for activation and retention.  
- Growth experiments: design and run acquisition/activation experiments, measure lift, and synthesize learnings.  
- Monetization and pricing experiments: design pricing, run small paid tests, and pass validated models to Finance/Marketplace.  
- Handoff & spinout: prepare production-ready manifests, legal contracts, financing, and marketplace SKUs or internal integrations.  
- Governance & ROI: measure product ROI and obey Kernel allocation rules for resources and budgets.

---

## Minimal external interfaces (intents)
These are services and data that other modules consume (or that Product calls):

- `POST /product/idea` — submit an idea/blueprint (title, hypothesis, owner, expected impact, budget).  
- `GET  /product/ideas` — list ideas with scoring and status.  
- `POST /product/score` — update idea score (metrics, manual rating, model output).  
- `POST /product/sprint` — create sprint plan (milestones, owners, acceptance criteria).  
- `POST /product/mvp/launch` — register an MVP launch (productId, version, features, measurement plan).  
- `POST /product/experiment` — start an experiment (type, target metric, audience, budget). Returns experimentId.  
- `GET  /product/experiment/{id}` — fetch experiment results and metrics.  
- `POST /product/handoff` — signal product is ready for production (includes manifests, legal, market plan, pricing). Triggers multisig/governance gates if needed.  
- `GET  /product/metrics/{productId}` — aggregated funnel metrics (acquisition → activation → retention → revenue).

**Notes:** All mutate calls must be auditable (produce AuditEvents). Budget consumption or resource allocation requests go via Kernel/Resource Allocator.

---

## Canonical models (short)

### ProductIdea
- `id`, `title`, `owner`, `description`, `hypothesis`, `targetMetric`, `targetValue`, `estimatedBudget`, `status` (`backlog|discovery|mvp|scale|retired`), `score`, `createdAt`.

### Sprint
- `id`, `productId`, `owner`, `startDate`, `endDate`, `milestones[]`, `acceptanceCriteria`, `status`.

### Experiment
- `id`, `productId`, `type` (`acquisition|activation|pricing|onboarding`), `variantSpec[]`, `targetMetric`, `audience`, `budget`, `results` (metrics), `conclusion`, `createdAt`.

### MVPRecord
- `id`, `productId`, `version`, `features[]`, `measurementPlan` (events, funnels, thresholds), `launchDate`, `status`, `manifestId` (Kernel manifest link).

---

## Processes & rules

### Idea-to-MVP flow
1. Capture Idea → score (manual + automated model) → decide discovery.  
2. Discovery: research, proto, interviews → decide MVP or pivot. Record all evidence and synthesize into a short memo (store in Memory Layer with manifest reference).  
3. MVP: build minimal feature set, instrument for metrics (acquisition, activation, retention), run a small cohort launch, collect results.  
4. Evaluate: if target activation/retention met, move to scale; otherwise iterate or kill. All decisions recorded in Reasoning Graph and audited.

### Experiment governance
- Experiments must include a measurement plan and pre-registered analysis.  
- Budget per experiment is constrained; requests above threshold require Kernel allocation and possibly Finance approval.  
- Results are canonicalized, stored in Memory Layer, and fed to Eval Engine/Reasoning Graph.

### Handoff & production gate
- Handoff requires: signed manifest describing product features, infra plan, costs, legal checklist, and a go/no-go signoff (multisig if required by policy or budget).  
- Marketplace listing or internal platform integration requires Kernel manifest signature and Finance confirmation for pricing.

---

## Integrations & tooling
- **Kernel**: register manifests, request allocations, sign critical documents, and write audit events.  
- **Memory Layer**: store research artifacts, user interviews, and evidence docs with embeddings for search.  
- **Reasoning Graph**: record decision rationales and traces for major go/no-go decisions.  
- **Eval Engine**: feed product metrics to Eval to score product ROI and lifecycle.  
- **Market & Media**: coordinate launches, PR, and content distribution; Market & Media runs promotional experiments.  
- **Finance**: for budget, pricing, and eventual revenue reconciliation.  
- **Legal**: templated contracts, NDA handling, IP/ownership checks before market launch.

---

## Metrics & success criteria
- **Leading metrics:** experiment lift (A/B delta), activation rate, conversion rate from acquisition to activation.  
- **Outcome metrics:** retention (7d, 30d), activation % (first valuable action), CAC, payback period, MRR/ARPU where relevant.  
- **Operational metrics:** experiment velocity (experiments/month), feature cycle time, time to first measurable result.

---

## Safety & compliance
- Products that process PII must have data handling plans, SentinelNet checks, and legal approvals.  
- Budget or resource requests triggering high-risk flows must go through multisig and SentinelNet.  
- Product teams must follow legal & compliance checklist (terms of service, privacy policy, data residency).

---

## Acceptance criteria (minimal)
- Idea registration → discovery → MVP cycles can be recorded end-to-end with evidence stored in Memory Layer and audit events emitted.  
- Experiments start/stop and results stored; A/B experiment analysis and conclusion recorded.  
- MVP launch triggers measurement plan instrumentation; funnel metrics are captured and accessible.  
- Handoff creates a Kernel manifest, and multisig/governance gates enforce production readiness for high-risk or high-budget products.  
- Integration: product metrics surface to Eval Engine and Reasoning Graph for scoring and traceability.  
- Security: products that require PII must be blocked from launch without SentinelNet approval and Legal sign-off.

---

## Operational notes & team roles
- Typical roles: ProductManager (vision), GrowthHacker (acquisition experiments), TechnicalLead (MVP), UXResearcher (interviews), DataAnalyst (experiment analysis).  
- Keep sprint cadence short and experiments fast; do small bets frequently.  
- Record every hypothesis, experiment, and decision in Memory Layer and Reasoning Graph.

---

## Example flow (short)
1. Submit idea “Auto-onboarding for creators” with hypothesis: increase 7d activation by 20% for new creators.  
2. Run discovery interviews, create prototype, store transcripts in Memory Layer.  
3. Launch MVP to a 5% cohort with instrumentation.  
4. Run experiment; results show +25% activation — record experiment result, prepare handoff.  
5. Handoff includes manifest, pricing plan, legal checklist — Kernel multisig approves and Finance provisions scale budget. Product moves to scale.

---

End of file.

