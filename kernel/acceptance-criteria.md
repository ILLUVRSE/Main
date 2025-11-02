# Kernel — Acceptance Criteria

Purpose: clear, testable checks that prove the Kernel API & Governance module is correct, secure, and ready for upstream modules to depend on. Each criterion is short and verifiable.

---

## 1) API surface & contract
- **Endpoints implemented:** The kernel exposes the documented endpoints (division, agent, agent state, eval, allocate, sign, audit, reason, security/status).  
- **Schema matches spec:** Request and response shapes follow `openapi.yaml` and `data-models.md`. Schema validation rejects malformed requests with `400`.  
- **Idempotency:** Mutation endpoints accept an idempotency key header to avoid duplicate events.

**How to verify:** Run a contract validator (OpenAPI tool) against `openapi.yaml` and exercise endpoints with valid/invalid payloads. Confirm `400` on validation failures.

---

## 2) RBAC & Authentication
- **RBAC enforced:** Each endpoint enforces role checks. SuperAdmin, DivisionLead, Operator, Auditor have the appropriate rights.  
- **Human auth via OIDC:** Interactive flows require SSO/OIDC.  
- **Service auth via mTLS:** Services authenticate with mTLS certs and are mapped to service roles.

**How to verify:** Test calls with different role credentials to confirm allowed vs denied; verify `401`/`403` codes for unauthenticated/unauthorized attempts.

---

## 3) Manifest signing & key management
- **Signing works:** Kernel produces `ManifestSignature` records for manifests and returns them on `POST /kernel/sign`. Signatures are Ed25519 and verifiable with the public key.  
- **KMS/HSM usage described:** Signing keys referenced by `signerId` and not stored in plaintext in repo.  
- **Key rotation procedure present:** A documented rotation flow exists and rotation events are auditable.

**How to verify:** Create a manifest, call `/kernel/sign`, retrieve the signature, verify signature with public key via standard Ed25519 verification. Review `security-governance.md` for rotation steps.

---

## 4) Audit log integrity
- **Append-only events:** Audit events are generated for every critical change and stored append-only.  
- **Hash chain & signatures:** Each `AuditEvent` includes `prevHash`, `hash`, and `signature`. Chain verification succeeds end-to-end.  
- **Export/proof tool:** A verification tool or documented process can validate chain integrity and produce a head hash proof.

**How to verify:** Produce 10-20 audit events, run chain verification to confirm hashes and signatures match; attempt tamper and confirm verification fails.

---

## 5) Multi-sig upgrade workflow
- **3-of-5 enforced:** Kernel accepts approval records, validates signatures, and only applies upgrades with 3 distinct valid approvals.  
- **Upgrade artifacts stored:** Upgrade manifest, approvals, and applied record are in the upgrade registry and emitted as audit events.  
- **Emergency flow:** Emergency apply and retroactive ratification logic works as documented.

**How to verify:** Simulate an upgrade: create manifest, submit approvals from three approvers, confirm Kernel applies upgrade and emits `upgrade.applied`. Test emergency apply path and retroactive ratification.

---

## 6) SentinelNet policy integration
- **Policy checks enforced:** SentinelNet can block or quarantine requests; Kernel respects SentinelNet responses for allocations and critical actions.  
- **Policy decisions audited:** Every SentinelNet decision emits an audit event with policy id and rationale.

**How to verify:** Deploy a test policy that rejects allocations beyond a small threshold. Attempt an allocation beyond the threshold and confirm a `403` with policy details and an audit event logged.

---

## 7) Eval ingestion & scoring hook
- **Eval accepted:** Kernel stores EvalReports and exposes them to the Eval Engine.  
- **Agent score updated:** Submitting evals updates agent’s computed or cached score as per the model in `data-models.md`.

**How to verify:** Submit evals for an agent and confirm the agent’s `score` changes and `POST /kernel/eval` returns `ok` with `eval_id`.

---

## 8) Reasoning trace retrieval
- **Trace accessible:** `GET /kernel/reason/{node}` returns a readable trace with steps and timestamps.  
- **PII redaction:** Sensitive data is redacted per SentinelNet rules before returning traces to UI.

**How to verify:** Create a sample reasoning node and confirm the trace is returned and any PII flagged by SentinelNet is redacted.

---

## 9) Storage & durability
- **Durable sink for audit:** Audit events are persisted to a durable storage and archived (S3 or equivalent).  
- **DB schema present:** Postgres schema matches `data-models.md` and includes required indexes.  
- **Embeddings stored in vector DB:** MemoryNode references exist and vector DB contains embeddings.

**How to verify:** Inspect storage sinks for audit events and confirm Postgres tables and indexes exist. Check vector DB contains test embeddings and can be joined via `embeddingId`.

---

## 10) Tests & automation
- **Unit tests:** Core modules (signature validation, audit chaining, multisig validator) have unit tests with at least 80% coverage.  
- **Integration tests:** End-to-end tests for: create division → sign → spawn agent → submit eval → allocation.  
- **Security tests:** Static analysis and a basic DAST scan performed; secrets are not checked into repo.

**How to verify:** Run test suite and security scans; ensure all pass. Check coverage report.

---

## 11) Operational & monitoring checks
- **Health endpoint:** `/health` returns ok and timestamp.  
- **Metrics & logs:** Kernel exports Prometheus metrics for p95/p99 latency, request rate, error rate, sign operations/sec.  
- **Alerting:** SLO breaches and key rotation failures trigger alerts.

**How to verify:** Call `/health`, check metrics endpoint, and simulate an SLO violation to confirm alerting flow (or review alert rules documentation).

---

## 12) Compliance & docs
- **Documentation present:** `kernel-api-spec.md`, `openapi.yaml`, `data-models.md`, `security-governance.md`, `audit-log-spec.md`, `multisig-workflow.md`, `api-examples.md`, and this acceptance criteria file are present in the `kernel` folder.  
- **Sign-off:** Ryan (SuperAdmin) and Security Engineer must sign off on the module before it’s considered live.

**How to verify:** Confirm files exist and obtain sign-off.

---

## 13) Performance & scale baseline
- **Latency:** API p95 < 200ms for core read endpoints under baseline load.  
- **Throughput:** Audit event pipeline can sustain X events/sec (define X during implementation).  
- **Scaling:** Document how to scale Kafka partitions, DB replicas, and vector DB shards.

**How to verify:** Run a baseline load test and confirm metrics; document scaling steps.

---

## Final acceptance statement
The Kernel API & Governance module is accepted when all above checks pass, automated tests are green, audit integrity verified, and Ryan + Security Engineer formally approve. At that point, downstream modules (Agent Manager, Memory Layer, Eval Engine) may be implemented against the Kernel contract.


