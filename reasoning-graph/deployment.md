# Reasoning Graph — Deployment & Infrastructure Guide

Purpose: operational, implementation-ready guidance for deploying the Reasoning Graph service. This covers recommended infra, deployment patterns, storage choices, signing/snapshot mechanics, scaling, security, backups, DR, CI/CD, and minimal runbooks. Keep this as the authoritative operational doc.

---

## 1) High-level deployment architecture
- **Reasoning Graph Service** — stateless API/backend that accepts Kernel-authorized writes (nodes/edges), computes traces, stores metadata, and coordinates snapshot signing.  
- **Storage layer**:
  - **Graph store** — graph database (Neo4j, JanusGraph, or DGraph) **OR** Postgres with adjacency/materialized views for smaller scale.  
  - **Postgres** — authoritative relational store for node/edge metadata, snapshots, and indices; used alongside graph DB for joins and audit pointers.  
  - **S3** — store heavy payloads, full snapshot JSON, canonicalized exports, and signed snapshot artifacts.  
- **Audit pipeline** — Kafka/Redpanda topic for audit events; durable sink to S3 and Postgres index.  
- **Signing / Key service** — KMS/HSM (or signing proxy) for snapshot and important-node signatures.  
- **CommandPad / UI** — reads traces via the Reasoning Graph API; annotations written back through Kernel.  
- **SentinelNet** — policy checks are invoked before writes that could expose sensitive data (optional pre-write check).  
- **CI/CD & Canary** — controlled rollout with canary snapshots and verification.

Diagram (conceptual):  
`Kernel (mTLS) → Reasoning Graph API → (Graph DB + Postgres + S3 + KMS)`  
Audit events → Kafka → S3 + Postgres

---

## 2) Recommended infra & providers
- **Kubernetes** — deploy service as K8s Deployments in `illuvrse-reasoning` namespace. Use Helm for templating.  
- **Graph DB** — choose based on scale:
  - Small-to-medium: **Postgres with adjacency tables** + materialized views (cheaper, easier ops).  
  - Medium-to-large or heavy traversal workloads: **Neo4j** (managed or self-hosted) or **JanusGraph** over Cassandra/Scylla.  
  - Consider DGraph for distributed graph if you need horizontal scaling with graph-native queries.
- **Postgres** — managed DB for relational metadata, indexes, and snapshot records.  
- **S3-compatible storage** — for snapshots and exports (enable versioning and object lock).  
- **Kafka/Redpanda** — for audit/event streaming.  
- **KMS/HSM or Cloud KMS** — for signatures. Ensure it supports Ed25519 or provide a signing proxy.  
- **Monitoring & tracing** — Prometheus, Grafana, OpenTelemetry/Jaeger.  
- **Vault / Secrets Manager** — for certs and service credentials.

---

## 3) Kubernetes deployment patterns
- **Helm chart**: include Deployment, Service, ConfigMap, Secret templates, HPA, PodDisruptionBudget, and RBAC.  
- **Replica config**: default replicas 2; use HPA based on CPU and custom metrics (request queue depth).  
- **Leader election**: implement leader election (K8s Lease) for operations that must be single-writer (snapshot creation & signing orchestration).  
- **Stateful components**: graph DB may be stateful; if self-hosted, deploy using operator/StatefulSet with stable storage. For managed graph DBs, treat them as external services.

---

## 4) Graph storage & canonicalization
- **Choice**:
  - If using graph DB (Neo4j/JanusGraph): store nodes/edges natively; keep node payloads small and store heavy payloads in S3. Use indices for `type`, `author`, `createdAt`, `tags`.  
  - If using Postgres: store `reason_nodes`, `reason_edges`, and maintain adjacency tables; precompute adjacency lists or materialized views for traversal performance.
- **Canonicalization**: define and implement a canonical JSON method for node sets and snapshots (same algorithm as Audit Log). Snapshot JSON must be deterministic for hashing and signing. Document canonicalization in the repo.
- **Snapshots**: snapshot = canonicalized JSON of selected root nodes + related subgraph. Store snapshot file in S3, compute SHA-256 hash, request KMS signature, and record `snapshot` record in Postgres linking to its ManifestSignature/AuditEvent.

---

## 5) Signing & snapshot workflow
1. Kernel or Reasoning service requests a snapshot (or snapshot triggered by event).  
2. Service builds canonical JSON for the snapshot and computes SHA-256 hash.  
3. The service requests a signature from KMS/HSM or a signing proxy (service must be authorized via mTLS + role).  
4. Store signed snapshot to S3 with metadata: `snapshotId`, `hash`, `signature`, `signerId`, `ts`. Emit an `audit` event linking snapshot and signature.  
5. Make snapshot retrievable by auditors via `GET /reason/snapshot/{id}` with verification metadata.

Ensure signing and storage are atomic: do not accept an applied/complete state until signature and S3 write succeed.

---

## 6) Security & access control
- **mTLS**: Kernel must authenticate to Reasoning Graph via mTLS; reject non-mTLS writes. Map client CN to identity and apply RBAC.  
- **RBAC**: Kernel-authorized writes only. CommandPad/Command flows that write require elevated authorization via Kernel.  
- **PII & SentinelNet**: Call SentinelNet as a pre-write hook for nodes containing potential PII or sensitive payloads. If SentinelNet denies, record `policyCheck` node with rationale.  
- **Signing keys**: keep signer keys in KMS/HSM. Do not store private keys in cluster secrets. Public keys are exposed via `GET /kernel/security/status` or Key Registry.  
- **Network policies**: restrict Reasoning service egress and ingress to required services only.

---

## 7) Backups, DR & replay
- **Graph DB**: schedule snapshots/backups per provider guidance. Store backups to S3 with versioning. Test restore procedures regularly.  
- **Postgres**: enable PITR, daily snapshots, and cross-region replication if required.  
- **Snapshots**: snapshots stored in S3 are retained per retention policy and serve as auditable checkpoints for rebuilds.  
- **Replay**: allow rebuilding graph metadata by replaying audit events; document replay steps and verify snapshots/hashes during rebuild. Provide a “safe mode” where signing is suspended while rebuilding.

---

## 8) Observability & SLOs
- **Metrics**: request rate, request latency (p50/p95/p99), snapshot creation latency, signature latency, traversal time (trace query p95).  
- **Tracing**: propagate trace ids from Kernel through Reasoning Graph; include spans for canonicalization, hash, signature, and S3 write.  
- **Alerts**: snapshot failures, signature errors from KMS, high traversal latency, graph DB connectivity issues, audit pipeline lag.  
- **SLO examples**: trace query p95 < 200ms for small traces; snapshot creation median < X seconds (depends on graph size).

---

## 9) Scaling & performance
- **Hot traces**: cache frequently requested traces or precompute materialized subgraphs for heavy queries.  
- **Sharding**: partition graphs by root or by division for large scale. Use tenant namespaces to isolate workloads.  
- **Pagination & cursoring**: deep traversals must support depth limits, pagination, and cursor-based traversal to avoid expensive full-graph operations.  
- **Rate limits**: enforce client rate limits and quotas per division/actor to prevent graph flooding.

---

## 10) CI/CD & release strategy
- **Pipeline**: lint + unit tests + integration tests (graph operations, canonicalization, signature flow) → build image → scan (Trivy/Snyk) → push → deploy to staging.  
- **Acceptance tests**: run snapshot creation + verification, trace queries, SentinelNet rejection tests.  
- **Canary release**: roll out to a small percentage of traffic; validate snapshot/verify flows before full rollout.  
- **Multi-sig gating**: major governance or signing changes require multisig approvals and extra CI checks.

---

## 11) Testing & validation
- **Unit tests**: canonicalization, hash/signature verification, cycle detection in traversal.  
- **Integration tests**: full create-node → create-edge → trace query → snapshot → sign → export flow.  
- **Property tests**: verify canonical JSON determinism across language runtimes.  
- **Security tests**: SentinelNet policy enforcement, mTLS auth tests, KMS access control tests.

---

## 12) Runbooks (must exist)
- Snapshot creation failure: troubleshoot canonicalization errors, KMS signing failures, or S3 upload errors.  
- Graph DB degraded: failover steps, restore from snapshot, validate hash chain, and resume operations.  
- Key compromise: emergency revoke, halt signing, replay verification, and rotate keys (see security-governance).  
- Replay & rebuild: steps to replay audit events to rebuild graph + verification checks.

---

## 13) Acceptance criteria (deployment)
- Reasoning Graph service deploys to staging and `GET /health` returns ok.  
- Node and edge writes succeed only from Kernel (mTLS); unauthorized writes rejected.  
- Trace queries return expected ordered traces with correct metadata under test workload.  
- Snapshot creation produces canonical JSON, a valid SHA-256 hash, and a signature recorded in audit and stored in S3.  
- Snapshot verification tool validates signature/hash from S3 successfully.  
- DR: restore drill from a recent backup or S3 snapshot succeeds and resulting graph is queryable.  
- Monitoring & alerts for signature and snapshot failures are active.

---

## 14) Operational notes
- Prefer managed graph DB where possible to reduce ops burden.  
- Keep payloads small in the graph; large content belongs in S3 with a pointer in the node.  
- Canonicalization must be implemented consistently across services. Document the exact algorithm and provide reference code.  
- Be conservative with automatic deletion; reasoning artifacts support audits and investigations.

---

End of file.

