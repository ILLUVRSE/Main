# Eval Engine & Resource Allocator — Core Module

## # Purpose
This module contains the Eval Engine (continuous scoring, recommendations, retrain orchestration) and the Resource Allocator (compute/capital assignment). Together they convert telemetry and EvalReports into actionable promotions, retrains, and allocation changes — all under Kernel governance and SentinelNet policy.

## # Location
All files for this module live under:
~/ILLUVRSE/Main/eval-engine/

## # Files in this module
- `eval-engine-spec.md` — core specification: responsibilities, APIs, models, flows, safety, and integration.
- `README.md` — this file.
- `deployment.md` — deployment and infra guidance covering Eval ingestion + Resource Allocator services.
- `api.md` — API surface and examples for Eval ingestion, promotion, and allocator endpoints.
- `acceptance-criteria.md` — testable checks for the module.
- `.gitignore` — local ignores for runtime files.

## # How to use this module
1. Read `eval-engine-spec.md` to understand scoring principles, promotion/ demotion logic, retrain flow, and Resource Allocator responsibilities.
2. Implement Eval ingestion, scoring, and PromotionEvent generation. Ensure every recommendation writes to the Reasoning Graph and Audit Bus for explainability.
3. Implement Resource Allocator to process allocation requests, call SentinelNet for policy checks, and interact with infra controllers or Finance for capital allocations.
4. Ensure all state changes and promotions produce AuditEvents and are signed/chain-verified per Audit Log spec.
5. Implement canary/evaluation flows so promotions are first tried in limited capacity before broad apply.

## # Key integration points
- **Kernel**: RBAC gate, audit emission, and central orchestrator for allocation workflows.
- **SentinelNet**: policy checks that can block or require escalation.
- **Resource pools / infra**: compute pools (Kubernetes / GPU clusters) and Finance for capital transfers.
- **Reasoning Graph & Memory Layer**: record explanation traces and keep provenance.
- **Agent Manager**: applies runtime changes once allocation is approved and issued.

## # Security & governance
- All interactions are mTLS + RBAC; Kernel mediates human actions.
- Budget and finance constraints are enforced; capital allocations require Finance acknowledgment and may require multi-sig for large amounts.
- Auditability: every promotion/allocation/retrain action is recorded as an AuditEvent with hash/signature.

## # Acceptance & sign-off
The module is accepted when the acceptance criteria described in `eval-engine-spec.md` are implemented and verified: scoring correctness, promotion + allocation flows, policy enforcement, auditability, retrain lifecycle, and operational SLOs. Final approver: **Ryan (SuperAdmin)**. Security Engineer must review policy enforcement and finance integration.

## # Quick start
1. Apply migrations: `psql $DATABASE_URL -f eval-engine/sql/migrations/001_init.sql`.
2. Start Resource Allocator: `go run ./eval-engine/cmd/resource-allocator-service`.
3. Start Eval ingestion service: `RESOURCE_ALLOCATOR_URL=http://localhost:8052 go run ./eval-engine/cmd/eval-ingestion-service`.
4. Run acceptance test: `go test ./eval-engine/internal/acceptance -run PromotionAllocation`.

These steps exercise the promotion → allocation → SentinelNet policy flow end to end.

---

End of README.
