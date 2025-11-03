# Reasoning Graph — Acceptance Criteria

Purpose: short, verifiable checks proving the Reasoning Graph is correct, secure, and production-ready. Each item is actionable and testable.

---

## # 1) API & contract
- **Endpoints implemented:** `POST /reason/node`, `POST /reason/edge`, `GET /reason/node/{id}`, `GET /reason/trace/{id}`, `POST /reason/snapshot`, `GET /reason/snapshot/{id}`, `POST /reason/query`, `POST /reason/annotate/{id}`, `GET /reason/export/{id}` exist and match the spec.
- **Auth enforced:** All write endpoints accept requests only from Kernel (mTLS + RBAC). Read endpoints enforce RBAC and PII redaction per SentinelNet policy.

**How to verify:** Run contract tests against the API, and test unauthenticated/unauthorized attempts to write and read.

---

## # 2) Node & edge creation → audit
- **Audit linkage:** Every created node/edge emits an AuditEvent linking the node/edge id, payload hash, signerId (when applicable), and `manifestSignatureId`.
- **Append-only behavior:** Nodes and edges are append-only; corrections are created as new nodes linked to originals.

**How to verify:** Create nodes and edges; verify corresponding AuditEvents in the audit sink and run hash/signature verification.

---

## # 3) Trace queries & traversal correctness
- **Trace retrieval works:** `GET /reason/trace/{id}` returns ordered, annotated traces with ancestors/descendants per requested direction and depth.
- **Cycle handling:** Traversal detects cycles and avoids infinite loops; cycles are annotated in the returned trace.
- **Performance:** Small-to-medium traces return within SLO (e.g., p95 < 200ms).

**How to verify:** Create a synthetic graph with known causal chains and cycles; run trace queries and confirm ordering, annotations, and performance.

---

## # 4) Snapshot creation, canonicalization & signing
- **Canonicalization defined & stable:** Canonical JSON algorithm is documented and deterministic across runtimes.
- **Snapshot hashing & signing:** Snapshot process computes SHA-256, obtains an Ed25519 signature via KMS/HSM, stores snapshot in S3, and emits an audit event linking hash + signature.
- **Verification tool:** A verification utility validates snapshot hash/signature and confirms stored snapshot matches canonical form.

**How to verify:** Create snapshot, verify hash/signature using the tool, and confirm S3 stored snapshot and audit event exist.

---

## # 5) Provenance & integration
- **Provenance links:** Nodes/edges referencing decisions, evaluations, or policies include `manifestSignatureId` or `auditEventId` proving authorization.
- **Integration tested:** Eval Engine, Agent Manager, and SentinelNet can produce/consume nodes and edges: scores → recommendations → decisions → policyChecks flow recorded in graph.

**How to verify:** Simulate or run full flow: Eval writes score → recommendation → decision → SentinelNet policyCheck; verify nodes/edges and provenance links.

---

## # 6) PII handling & SentinelNet enforcement
- **PII redaction:** Traces returned to unauthorized viewers are redacted according to SentinelNet policies.
- **Pre-write checks:** SentinelNet rejects nodes containing prohibited content; such rejections produce `policyCheck` nodes.

**How to verify:** Insert a node with flagged PII and confirm SentinelNet denial or redaction behavior and `policyCheck` audit event.

---

## # 7) Snapshot export & auditor workflows
- **Human-readable exports:** `GET /reason/export/{id}?format=human` produces a readable trace/snapshot for auditors including signature metadata.
- **Canonical export for verification:** `format=canonical` returns canonical JSON necessary for cryptographic verification.

**How to verify:** Export snapshot in both formats and use verification tool to validate canonical export.

---

## # 8) Durability, backup & restore
- **Durable storage:** Snapshots and exports stored in S3 with versioning and object lock for audit buckets.
- **Restore & replay:** Ability to rebuild graph metadata from audit events and snapshots verified in a restore drill.

**How to verify:** Run restore drill: restore DB from backup or replay audit events, rebuild graph, run sample trace queries and verify snapshots/hashes.

---

## # 9) Observability & SLOs
- **Metrics:** request rate, trace latency (p50/p95/p99), snapshot creation latency, signature latency, error rate, and queue/backlog metrics exported.
- **Tracing:** end-to-end traces propagated and visible (canonicalization, hash, signature, S3 write spans).
- **Alerts:** set for snapshot/signature failures, trace latency, and graph DB connectivity.

**How to verify:** Check Prometheus/Grafana dashboards and simulate error conditions to validate alerts.

---

## # 10) Tests & automation
- **Unit tests:** canonicalization, hash/signature verification, cycle detection.
- **Integration tests:** create node/edge → trace → snapshot → sign → export.
- **Property/determinism tests:** canonicalization must produce identical output across language runtimes and repeated runs.
- **Security tests:** mTLS auth tests, SentinelNet policy enforcement tests, KMS access control tests.

**How to verify:** Run the full test suite in CI and validate results.

---

## # 11) Performance & scale
- **Small-trace SLO:** trace queries for traces under configured depth return under p95 threshold (e.g., <200ms).
- **Snapshot capability:** snapshot process for small-to-medium subgraphs completes within defined median time (documented).
- **Scaling plan:** sharding or caching strategy documented for large graphs.

**How to verify:** Run performance tests and review scaling documentation and test results.

---

## # 12) Security & governance
- **mTLS + RBAC:** Kernel-only writes; read access limited per role.
- **Signer/key handling:** Snapshot signing uses KMS/HSM keys; keys are not stored in cluster secrets.
- **Audit events:** All important actions (node/edge creation, snapshot, signature) emit AuditEvents and are verifiable.

**How to verify:** Attempt unauthorized writes; confirm rejection. Verify signature flow and audit events.

---

## # 13) Documentation & sign-off
- **Docs present:** `reasoning-graph-spec.md`, `deployment.md`, `README.md`, and this acceptance criteria file exist.
- **Sign-off:** Security Engineer and Ryan sign off; record sign-off as an audit event.

**How to verify:** Confirm docs present and obtain written sign-off recorded in audit log.

---

## # Final acceptance statement
The Reasoning Graph is accepted when all above criteria pass in staging (or prod-equivalent) environment, the test suite is green, canonicalization and signature verification succeed, integrations work end-to-end, and formal sign-off by Ryan and the Security Engineer is recorded.

