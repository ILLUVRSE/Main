# ILLUVRSE — Final Completion Criteria (machine-friendly)

NOTE: Each unchecked task must be a single-line markdown checkbox with this exact internal format:
- [ ] TASK: <short title> || ACCEPTANCE: <exact, machine-checkable acceptance criteria> || ALLOWED: [<path1>,<path2>,...] || TESTS: <test command> || OWNER: <name>

Your autorun will pass the whole line (after the checkbox) to RepoWriter as the task description. Keep each ACCEPTANCE explicit and the ALLOWED list conservative.

---

## Kernel — Minimum completion (must be 100% done)

- [ ] TASK: OpenAPI + server || ACCEPTANCE: openapi.yaml exists at kernel/openapi.yaml and implemented endpoints `POST /kernel/sign`, `POST /kernel/agent`, `POST /kernel/allocate`, `POST /kernel/division`, `GET /kernel/audit/{id}`, `GET /kernel/reason/{node}` respond per contract tests (JSON schema match, 200 on health call). || ALLOWED: ["kernel/","server/","RepoWriter/server/"] || TESTS: npm --prefix kernel run test || OWNER: Ryan
- [ ] TASK: RBAC & Auth || ACCEPTANCE: OIDC/SSO for humans and mTLS for service-to-service enforced on Kernel endpoints; SuperAdmin role exists and tests exercise positive and negative access. || ALLOWED: ["kernel/","infra/","RepoWriter/server/"] || TESTS: ./scripts/test-rbac.sh || OWNER: Security Engineer
- [ ] TASK: Manifest signing || ACCEPTANCE: Kernel integrates with KMS/HSM to produce Ed25519 ManifestSignature objects; POST /kernel/sign returns signed manifest and signature verifies; key rotation and key use are audited by tests. || ALLOWED: ["kernel/","infra/"] || TESTS: ./scripts/test-signing.sh || OWNER: Security Engineer
- [ ] TASK: Audit log (chained) || ACCEPTANCE: Kernel emits append-only AuditEvent objects with prevHash+SHA256+signature; events are published to Event Bus and archived to S3 with object-lock; verification script can replay and verify chain. || ALLOWED: ["kernel/","infra/"] || TESTS: python3 tools/verify_audit_chain.py || OWNER: Security Engineer
- [ ] TASK: Multisig upgrade flow || ACCEPTANCE: 3-of-5 multisig process for kernel upgrades implemented with tooling and automated tests that simulate threshold approval and blocked upgrade when insufficient signatures. || ALLOWED: ["kernel/","commandpad/"] || TESTS: ./scripts/test-multisig.sh || OWNER: Ryan
- [ ] TASK: Operational SLOs & runbooks || ACCEPTANCE: SLOs documented for kernel, dashboards linked; incident runbooks exist and automated runbook tests simulate recovery steps. || ALLOWED: ["kernel/","docs/","devops/"] || TESTS: ./scripts/test-runbooks.sh || OWNER: SRE
- [ ] TASK: Kernel acceptance sign-off || ACCEPTANCE: kernel/acceptance-criteria.md present and signed by Security Engineer + Ryan (signed files exist in kernel/signoffs/). || ALLOWED: ["kernel/","kernel/signoffs/"] || TESTS: test -f kernel/acceptance-criteria.md && test -f kernel/signoffs/security_engineer.sig || OWNER: Ryan

---

## Agent Manager — Minimum completion

- [ ] TASK: Spawn / lifecycle || ACCEPTANCE: POST /api/v1/agent/spawn returns agent_id and lifecycle APIs start/stop/restart/scale are idempotent and return correct status codes; integration tests exercise lifecycle flows. || ALLOWED: ["agent-manager/","AgentManager/","RepoWriter/server/"] || TESTS: npm --prefix agent-manager run test || OWNER: Ryan
- [ ] TASK: Manifest enforcement || ACCEPTANCE: Agent Manager rejects unsigned/invalid manifests with 403 and accepts kernel-signed manifests; tests simulate accept/reject. || ALLOWED: ["agent-manager/","RepoWriter/server/"] || TESTS: ./scripts/test-manifest-enforce.sh || OWNER: Security Engineer
- [ ] TASK: Sandbox runner || ACCEPTANCE: Sandbox run API executes tasks with isolation, returns run status (complete/pass/fail) and emits audit events; sandbox is auditable via logs. || ALLOWED: ["agent-manager/","RepoWriter/server/","RepoWriter/sandbox/"] || TESTS: npm --prefix agent-manager run sandbox-test || OWNER: Ryan
- [ ] TASK: Telemetry & audit || ACCEPTANCE: Agent Manager emits telemetry metrics and AuditEvents for spawn/start/stop/scale actions visible to Eval Engine. || ALLOWED: ["agent-manager/","metrics/"] || TESTS: python3 tools/check_telemetry.py || OWNER: SRE
- [ ] TASK: Local dev / Docker || ACCEPTANCE: docker-compose dev composition exists and starts Agent Manager with dependent services; smoke-tests pass. || ALLOWED: ["agent-manager/","devops/"] || TESTS: docker-compose -f dev/docker-compose.yml up --build --abort-on-container-exit || OWNER: Developer Lead
- [ ] TASK: Security review || ACCEPTANCE: KMS/signing reviewed and documented; Security Engineer stamp file present. || ALLOWED: ["agent-manager/","kernel/","infra/"] || TESTS: test -f agent-manager/security-review.txt || OWNER: Security Engineer
- [ ] TASK: Agent Manager sign-off || ACCEPTANCE: agent-manager/acceptance-criteria.md present and signed by Ryan + Security Engineer. || ALLOWED: ["agent-manager/","agent-manager/signoffs/"] || TESTS: test -f agent-manager/acceptance-criteria.md && test -f agent-manager/signoffs/ryan.sig || OWNER: Ryan

---

## Memory Layer — Minimum completion

- [ ] TASK: Storage & APIs || ACCEPTANCE: Postgres schema exists (memory_nodes, artifact) and Vector DB integration working; storeEmbedding/searchEmbedding APIs accept/store/search embeddings and return expected results in integration tests. || ALLOWED: ["memory-layer/","Memory/","infra/"] || TESTS: npm --prefix memory-layer run test || OWNER: Ryan
- [ ] TASK: Artifact guarantees || ACCEPTANCE: S3 artifact uploads create checksum entries linked to AuditEvents and manifestSignatureId; verification script validates checksums. || ALLOWED: ["memory-layer/","infra/"] || TESTS: python3 tools/test_artifacts.py || OWNER: Security Engineer
- [ ] TASK: Retention & legal-hold || ACCEPTANCE: TTL, soft-delete and legal-hold behaviors covered by unit/integration tests that simulate hold/unhold scenarios. || ALLOWED: ["memory-layer/"] || TESTS: npm --prefix memory-layer run retention-test || OWNER: Legal
- [ ] TASK: Encryption & access controls || ACCEPTANCE: TLS everywhere, encryption-at-rest verified, RBAC enforced for read/write; PII redaction and SentinelNet gating verified. || ALLOWED: ["memory-layer/","sentinelnet/","infra/"] || TESTS: ./scripts/test-security-memory.sh || OWNER: Security Engineer
- [ ] TASK: Backup & recovery || ACCEPTANCE: Backup/restore tested for Postgres and Vector DB with full recovery tests; replay from audit archives validated. || ALLOWED: ["memory-layer/","infra/"] || TESTS: ./scripts/test-backup-restore.sh || OWNER: SRE
- [ ] TASK: Memory Layer sign-off || ACCEPTANCE: memory-layer/acceptance-criteria.md present and signed by Security Engineer + Ryan. || ALLOWED: ["memory-layer/"] || TESTS: test -f memory-layer/acceptance-criteria.md && test -f memory-layer/signoffs/ryan.sig || OWNER: Ryan

---

## Reasoning Graph — Minimum completion

- [ ] TASK: Models & API || ACCEPTANCE: APIs for nodes/edges/traces implemented; writes accepted only via Kernel mTLS+RBAC; integration tests pass. || ALLOWED: ["reasoning-graph/","kernel/"] || TESTS: npm --prefix reasoning-graph run test || OWNER: Ryan
- [ ] TASK: Explainability & snapshots || ACCEPTANCE: explainable traces and signed snapshots with verifiable hash/signature exist; tests verify snapshot integrity. || ALLOWED: ["reasoning-graph/"] || TESTS: python3 tools/test_snapshots.py || OWNER: Security Engineer
- [ ] TASK: Append-only corrections || ACCEPTANCE: corrections are append-only and emit AuditEvents; tests verify immutability constraints. || ALLOWED: ["reasoning-graph/"] || TESTS: npm --prefix reasoning-graph run correction-test || OWNER: Ryan
- [ ] TASK: Integration tests || ACCEPTANCE: end-to-end tests with Kernel, Eval Engine, Agent Manager and SentinelNet pass. || ALLOWED: ["reasoning-graph/","kernel/","eval-engine/","sentinelnet/"] || TESTS: ./scripts/test-e2e-reasoning.sh || OWNER: Ryan
- [ ] TASK: Reasoning Graph sign-off || ACCEPTANCE: sign-offs by Security Engineer + Ryan documented. || ALLOWED: ["reasoning-graph/"] || TESTS: test -f reasoning-graph/signoffs/security_engineer.sig || OWNER: Ryan

---

## Eval Engine & Resource Allocator — Minimum completion

- [ ] TASK: Scoring & ingestion || ACCEPTANCE: Eval ingestion accepts EvalReports and scoring logic covered by unit tests. || ALLOWED: ["eval-engine/","Eval/"] || TESTS: npm --prefix eval-engine run test || OWNER: Ryan
- [ ] TASK: Promotion & allocation flows || ACCEPTANCE: Promotion events recorded to Reasoning Graph and Audit Bus; Resource Allocator interacts with Kernel/Finance; tests verify allocations and ledger entries. || ALLOWED: ["eval-engine/","reasoning-graph/","kernel/","finance/"] || TESTS: ./scripts/test-promotion-allocation.sh || OWNER: Finance Lead
- [ ] TASK: Policy gating || ACCEPTANCE: SentinelNet invoked and capable of blocking promotions; canary flows and rollbacks exist. || ALLOWED: ["eval-engine/","sentinelnet/"] || TESTS: ./scripts/test-policy-gate.sh || OWNER: Security Engineer
- [ ] TASK: Eval Engine sign-off || ACCEPTANCE: tests and SLOs validated and Ryan sign-off recorded. || ALLOWED: ["eval-engine/"] || TESTS: test -f eval-engine/signoffs/ryan.sig || OWNER: Ryan

---

## SentinelNet — Minimum completion

- [ ] TASK: Synchronous checks || ACCEPTANCE: Kernel pre-action synchronous checks implemented returning policyCheck events with explainability. || ALLOWED: ["sentinelnet/","kernel/"] || TESTS: npm --prefix sentinelnet run test || OWNER: Security Engineer
- [ ] TASK: Event stream detection || ACCEPTANCE: subscribes to Event Bus and emits signed policy audit events; detection tests pass. || ALLOWED: ["sentinelnet/","infra/"] || TESTS: python3 tools/test_detection.py || OWNER: Security Engineer
- [ ] TASK: Policy lifecycle tooling || ACCEPTANCE: versioning, simulation/dry-run, canary rollouts, and multisig gating implemented; tooling tests pass. || ALLOWED: ["sentinelnet/","commandpad/"] || TESTS: ./scripts/test-policy-lifecycle.sh || OWNER: Security Engineer
- [ ] TASK: SLOs & observability || ACCEPTANCE: latency metrics (p50/p95/p99) reported; runbooks present and tested. || ALLOWED: ["sentinelnet/","devops/"] || TESTS: ./scripts/test-observability.sh || OWNER: SRE
- [ ] TASK: SentinelNet sign-off || ACCEPTANCE: Security Engineer + Ryan sign-off documented. || ALLOWED: ["sentinelnet/"] || TESTS: test -f sentinelnet/signoffs/security_engineer.sig || OWNER: Security Engineer

---

## AI & Infrastructure — Minimum completion

- [ ] TASK: Reproducible training || ACCEPTANCE: training orchestration records provenance: codeRef, container digest, dataset checksums, hyperparams; reproducibility tests pass. || ALLOWED: ["ai-infra/","AIInfra/"] || TESTS: ./scripts/test-reproducible-training.sh || OWNER: ML Lead
- [ ] TASK: Model registry & lineage || ACCEPTANCE: registry stores lineage and signerId; promotions/canaries/rollbacks supported and tested. || ALLOWED: ["ai-infra/","model-registry/"] || TESTS: npm --prefix ai-infra run test || OWNER: ML Lead
- [ ] TASK: SentinelNet gating for models || ACCEPTANCE: promotions require SentinelNet clearance and manifestSignature for staging/prod. || ALLOWED: ["ai-infra/","sentinelnet/"] || TESTS: ./scripts/test-model-promotion.sh || OWNER: Security Engineer
- [ ] TASK: Serving & infra || ACCEPTANCE: serving stack with canaries, drift detection and SLOs implemented; tests verify canary promotion/rollback. || ALLOWED: ["ai-infra/","infra/"] || TESTS: ./scripts/test-serving.sh || OWNER: SRE
- [ ] TASK: AI Infra sign-off || ACCEPTANCE: ML Lead + Security Engineer + Ryan sign-off documented. || ALLOWED: ["ai-infra/"] || TESTS: test -f ai-infra/signoffs/ml_lead.sig || OWNER: ML Lead

---

## Marketplace — Minimum completion

- [ ] TASK: Catalog & checkout || ACCEPTANCE: listing, preview sandbox, checkout and secure DRM/encrypted delivery implemented and tested end-to-end. || ALLOWED: ["marketplace/","infra/"] || TESTS: ./scripts/test-marketplace-e2e.sh || OWNER: Marketplace Lead
- [ ] TASK: Manifest verification || ACCEPTANCE: marketplace validates Kernel-signed manifests prior to listing in preview and prod. || ALLOWED: ["marketplace/","kernel/"] || TESTS: ./scripts/test-manifest-verify.sh || OWNER: Security Engineer
- [ ] TASK: Payments & Finance integration || ACCEPTANCE: Stripe checkout integration with PCI compliance (or delegated Stripe setup) and Finance ledger entries + royalty splits tested. || ALLOWED: ["marketplace/","finance/"] || TESTS: ./scripts/test-payments.sh || OWNER: Finance Lead
- [ ] TASK: Audit & delivery || ACCEPTANCE: license/delivery artifacts signed and stored with audit trail; preview sandbox audits exist. || ALLOWED: ["marketplace/","memory-layer/"] || TESTS: python3 tools/test_delivery_audit.py || OWNER: Marketplace Lead
- [ ] TASK: Marketplace sign-off || ACCEPTANCE: Security + Finance + Ryan sign-off documented. || ALLOWED: ["marketplace/"] || TESTS: test -f marketplace/signoffs/security_engineer.sig || OWNER: Marketplace Lead

---

## Finance — Minimum completion

- [ ] TASK: Ledger correctness || ACCEPTANCE: double-entry journal API ensures balanced entries; reconciliation tooling exists and tests verify correctness. || ALLOWED: ["finance/","infra/"] || TESTS: npm --prefix finance run test || OWNER: Finance Lead
- [ ] TASK: Signed proofs || ACCEPTANCE: KMS/HSM-signed proofs for ledger ranges and signed export formats available; auditor export tests pass. || ALLOWED: ["finance/","infra/"] || TESTS: ./scripts/test-ledger-proofs.sh || OWNER: Security Engineer
- [ ] TASK: Isolation & governance || ACCEPTANCE: isolated high-trust environment and multisig for high-value actions; mTLS/OIDC enforced. || ALLOWED: ["finance/","infra/"] || TESTS: ./scripts/test-finance-gov.sh || OWNER: Finance Lead
- [ ] TASK: Finance sign-off || ACCEPTANCE: Finance Lead + Security Engineer + Ryan sign-offs documented. || ALLOWED: ["finance/"] || TESTS: test -f finance/signoffs/finance_lead.sig || OWNER: Finance Lead

---

## Capital, Product & MarketMedia — Minimum completion

- [ ] TASK: Product idea pipeline || ACCEPTANCE: IDEA service implements /product/idea, scoring and /product/handoff producing Kernel manifest and storing evidence in Memory; multisig for high-budget handoffs. || ALLOWED: ["IDEA/","product/","RepoWriter/"] || TESTS: ./scripts/test-idea-handoff.sh || OWNER: Product Lead
- [ ] TASK: Capital deal flows || ACCEPTANCE: deal registration, underwriting, allocation and multisig flows implemented and integrated with Finance. || ALLOWED: ["capital/","finance/"] || TESTS: ./scripts/test-capital.sh || OWNER: Capital Lead
- [ ] TASK: Market & Media lifecycle || ACCEPTANCE: asset lifecycle and campaign orchestration integrated with Eval and Finance; SentinelNet content checks in place. || ALLOWED: ["market-media/","market/"] || TESTS: npm --prefix market-media run test || OWNER: Market Lead

---

## RepoWriter and IDEA (product handoff automation)

- [ ] TASK: IDEA service || ACCEPTANCE: UI + service implements /product/idea, scoring, /product/handoff creating Kernel manifests and storing evidence in Memory; handoff triggers multisig when required. || ALLOWED: ["IDEA/","RepoWriter/","kernel/"] || TESTS: npm --prefix IDEA run test || OWNER: Product Lead
- [ ] TASK: RepoWriter automation || ACCEPTANCE: RepoWriter commits Kernel-signed manifests/SKUs/deployment templates to GitHub, triggers CI/preview deploys, attaches manifestSignatureId and emits AuditEvent; RepoWriter must never sign manifests itself. || ALLOWED: ["RepoWriter/",".github/"] || TESTS: npm --prefix RepoWriter run test || OWNER: Ryan
- [ ] TASK: CommandPad integration || ACCEPTANCE: CommandPad multisig flow used to approve handoff/production commits; approvals recorded as AuditEvents. || ALLOWED: ["commandpad/","RepoWriter/"] || TESTS: ./scripts/test-commandpad.sh || OWNER: Security Engineer

---

## Cross-cutting, non-functional & compliance requirements

- [ ] TASK: Audit chain || ACCEPTANCE: All critical actions emit AuditEvent on Event Bus; events chained (prevHash) and archived to S3 with object-lock; verification tooling exists and passes. || ALLOWED: ["infra/","kernel/","memory-layer/"] || TESTS: python3 tools/verify_audit_chain.py || OWNER: Security Engineer
- [ ] TASK: Security || ACCEPTANCE: OIDC/SSO for humans and mTLS for services；KMS/HSM for signing；multisig for high-value actions; no private keys in code. || ALLOWED: ["infra/","kernel/","security/"] || TESTS: ./scripts/test-security.sh || OWNER: Security Engineer
- [ ] TASK: PII & SentinelNet || ACCEPTANCE: PII detection, legal-hold and SentinelNet gating implemented; dry-run and canary modes exist. || ALLOWED: ["sentinelnet/","memory-layer/"] || TESTS: ./scripts/test-pii-guard.sh || OWNER: Legal
- [ ] TASK: Observability & SLOs || ACCEPTANCE: platform SLOs documented and dashboards/traces in place for Kernel, SentinelNet, Memory, Eval. || ALLOWED: ["devops/","infra/"] || TESTS: ./scripts/test-slo.sh || OWNER: SRE
- [ ] TASK: Backup & DR || ACCEPTANCE: backup and recovery tested for Postgres/VectorDB/Audit archives; runbook for rebuild from audit archives exists. || ALLOWED: ["infra/","memory-layer/"] || TESTS: ./scripts/test-dr.sh || OWNER: SRE
- [ ] TASK: CI/CD & reproducible builds || ACCEPTANCE: CI pipelines reproduce server/infra artifacts; training/serving reproducible and signed artifacts. || ALLOWED: [".github/","devops/","ai-infra/"] || TESTS: ./scripts/test-ci-repro.sh || OWNER: DevOps
- [ ] TASK: Legal & compliance || ACCEPTANCE: Stripe integration and PCI proof where applicable; export control/geofencing implemented. || ALLOWED: ["marketplace/","finance/","infra/"] || TESTS: ./scripts/test-compliance.sh || OWNER: Legal

---

## Testing matrix

- [ ] TASK: Unit test coverage || ACCEPTANCE: critical logic unit tests cover 100% of critical paths per module. || ALLOWED: ["**/test","**/tests"] || TESTS: ./scripts/check_coverage.sh || OWNER: Tech Lead
- [ ] TASK: Integration tests || ACCEPTANCE: external deps (KMS stubbed) verified via integration tests. || ALLOWED: ["tests/","infra/"] || TESTS: ./scripts/run_integration_tests.sh || OWNER: Tech Lead
- [ ] TASK: E2E scenarios || ACCEPTANCE: required E2E scenarios (product handoff→marketplace, agent lifecycle→eval→allocation) pass in staging. || ALLOWED: ["scripts/","tests/"] || TESTS: ./scripts/run_e2e.sh || OWNER: Ryan
- [ ] TASK: Performance & chaos || ACCEPTANCE: p95/p99 SLO verification and chaos/disaster recovery tests executed and passing. || ALLOWED: ["devops/","infra/"] || TESTS: ./scripts/run_performance_tests.sh || OWNER: SRE
- [ ] TASK: Security testing || ACCEPTANCE: pentests, secrets scanning and key compromise drills executed & remediations tracked. || ALLOWED: ["infra/","security/"] || TESTS: ./scripts/run_security_tests.sh || OWNER: Security Engineer

---

## Documentation & runbooks

- [ ] TASK: Documentation files present || ACCEPTANCE: each module has README.md, acceptance-criteria.md, openapi.yaml/api.md, deployment.md, security-governance.md, audit-log-spec.md, operational-runbook.md. || ALLOWED: ["**/README.md","**/acceptance-criteria.md","**/openapi.yaml","**/deployment.md","**/security-governance.md","**/audit-log-spec.md","**/operational-runbook.md"] || TESTS: python3 tools/check_acceptance.py || OWNER: Tech Lead

---

## Sign-off matrix & final audit verification

- [ ] TASK: Sign-off matrix || ACCEPTANCE: sign-offs collected from Security Engineer, Finance Lead, ML Lead and Ryan for core modules; signoff files present. || ALLOWED: ["**/signoffs/"] || TESTS: ./scripts/check_signoffs.sh || OWNER: Ryan
- [ ] TASK: Final audit verification || ACCEPTANCE: supervised audit replay test passes and E2E handoff→marketplace flow verified; SentinelNet policy gating and privacy tests pass. || ALLOWED: ["scripts/","tools/","infra/"] || TESTS: ./scripts/run_final_audit.sh || OWNER: Security Engineer

---

## Definition of “100% complete”

- [ ] TASK: Platform 100% complete summary || ACCEPTANCE: all module tasks complete and signed as above; final audit verification passed and recorded. || ALLOWED: ["progress/","kernel/","infra/"] || TESTS: python3 tools/check_acceptance.py && ./scripts/run_final_audit.sh || OWNER: Ryan

---

