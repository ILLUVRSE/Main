# Memory Layer — Acceptance Criteria

Purpose: a short, testable checklist proving the Memory Layer is correct, secure, and production-ready. Each item is actionable and verifiable.

---

# # 1) Schema & storage
- **Postgres schema implemented:** `memory_nodes`, `artifact`, and required indexes exist and match `memory-layer-spec.md`.
- **Vector DB connectivity:** Vector DB endpoint reachable and configured; test index exists for `kernel-memory` namespace.
- **S3 artifact storage:** Artifact bucket available with versioning and object lock enabled for audit buckets.

**How to verify:** Inspect DB schema; run a connection test to Vector DB; create a test object in S3 and confirm versioning/object-lock flags.

---

# # 2) Embedding pipeline
- **End-to-end ingestion:** Ingest a sample document; a `MemoryNode` row is created in Postgres and a corresponding vector exists in the Vector DB with the same `embeddingId`.
- **Model version recorded:** Embedding metadata records the model name/version used.
- **Idempotency:** Re-ingesting the same content with same checksum does not create duplicate entries.

**How to verify:** Submit a document, query Postgres for `memory_node`, query Vector DB for `embeddingId`, and check model/version metadata. Re-submit and confirm no duplicate.

---

# # 3) Semantic search
- **Top-K search works:** A semantic search with a test query returns expected relevant `memory_node.id`s and scores.
- **Filters applied:** Searches with metadata filters (owner, tags, date range) correctly limit results before/after scoring.
- **Hybrid scoring supported:** If hybrid mode is configured, combine semantic score with recency/importance and return predictable ordering.

**How to verify:** Create distinct test nodes with expected similarity and filters. Run search and validate ordering and filter behavior.

---

# # 4) Provenance & artifacts
- **Artifact metadata stored:** Put an artifact to S3 and ensure `artifact` record in Postgres contains checksum, path, owner, and `manifestSignatureId`.
- **Provenance link:** MemoryNode references artifact or manifestSignatureId where appropriate.
- **Signed audit event:** The write operation produces an audit event linking to the manifest signature and artifact.

**How to verify:** Upload artifact, check Postgres record, and verify audit event exists with matching fields and valid signature/hash.

---

# # 5) Retention, TTL & legal-hold
- **Default TTL enforced:** MemoryNodes older than TTL are soft-deleted or flagged for deletion per policy.
- **Legal hold respected:** Items under legal hold are excluded from TTL deletion.
- **Soft-delete semantics:** Soft-deleted nodes are not returned in normal queries but retained for legal/forensic workflows.

**How to verify:** Create nodes with varied `createdAt` and `legalHold` flags; run TTL job and confirm expected deletions and holds.

---

# # 6) Security & PII controls
- **TLS & encryption:** All in-transit connections use TLS; at-rest encryption enabled.
- **RBAC enforced:** Only authorized callers (Kernel/authorized services) can create/read nodes according to roles.
- **PII redaction:** Items flagged with `piiFlags` are restricted; read attempts by unauthorized callers fail or the data is redacted per SentinelNet policy.

**How to verify:** Attempt read/write from an unauthorized identity and confirm `403`; create PII-marked node and verify redaction or denial for non-authorized callers.

---

# # 7) Audit & immutability
- **Audit events emitted:** Every create/update/delete/embedding operation emits an AuditEvent with `manifestSignatureId`, `caller`, and provenance.
- **Hash/signature verifiable:** Audit events include `hash`, `prevHash`, and `signature` and pass verification.
- **Archive to S3:** Audit events are archived daily to S3 with immutability enabled.

**How to verify:** Produce a sequence of writes, fetch corresponding audit events, run chain verification, and confirm archived files exist in S3.

---

# # 8) Backup & recovery
- **Postgres backup tested:** PITR or snapshot restore test succeeds for a recent backup.
- **Vector DB snapshot & restore:** Vector DB snapshot/export and restore tested on a staging cluster.
- **Replay works:** Replaying archived audit events plus artifacts allows rebuilding the Postgres metadata and re-ingesting vectors.

**How to verify:** Run a restore drill for Postgres and Vector DB and verify application-level consistency (sample nodes present and searchable).

---

# # 9) Observability & SLOs
- **Metrics present:** Ingestion rate, vector write latency, search latency (p95), queue depth, and worker error rate are exported.
- **Tracing & logs:** End-to-end tracing (API → worker → Vector DB/Postgres) works and logs include `memoryNodeId` and `traceId`.
- **SLO targets defined:** Documented SLOs (e.g., search p95 < 200ms) with alerts configured.

**How to verify:** Check Prometheus/Grafana dashboards, run a search latency test, and confirm traces include expected spans and identifiers.

---

# # 10) Performance & scale
- **Throughput validated:** Embedding pipeline can sustain target ingestion rate (documented).
- **Search scale validated:** Vector DB returns top-K within SLO at expected dataset size.
- **Autoscaling behavior:** Workers and API scale under load without data loss and with acceptable latency.

**How to verify:** Run load tests simulating target throughput and confirm metrics + no data loss.

---

# # 11) Tests & automation
- **Unit tests:** Core logic (canonicalization, checksum, idempotency) covered by unit tests.
- **Integration tests:** Ingest → vector store → search, and backup/restore integration tests exist and pass.
- **Chaos tests:** Simulate Vector DB outage and confirm DLQ/backpressure behavior and recovery.

**How to verify:** Run test suite in CI and review results. Run chaos simulation and confirm graceful degradation and recovery.

---

# # 12) Documentation & sign-off
- **Docs present:** `memory-layer-spec.md`, `deployment.md`, `README.md`, `acceptance-criteria.md` are present and up-to-date.
- **Security review:** Security Engineer signs off on encryption, PII handling, and Vault/KMS integration.
- **Final approver:** Ryan signs off as SuperAdmin.

**How to verify:** Files present; obtain written sign-off and record it as an audit event.

---

# # Final acceptance statement
Memory Layer is accepted when all above criteria pass in the target environment (staging/production as applicable), automated tests are green, backups and restore drills succeed, audit integrity verified, and formal sign-off by Ryan and the Security Engineer is recorded.


