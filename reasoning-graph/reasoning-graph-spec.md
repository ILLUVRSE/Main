# Reasoning Graph — Specification

# # Purpose
The Reasoning Graph is the explainable, versioned causal/decision graph used by the Kernel to record how decisions were made, why allocations happened, and how agent recommendations propagated. It stores nodes (events, decisions, hypotheses), edges (causal links), and traces that can be queried for provenance, auditing, and human inspection.

The graph is NOT a replace-for-log; it complements the Audit Log by providing higher-level causal structure and human-readable reasoning traces.

---

# # Core responsibilities
- Store versioned nodes and edges representing reasoning artifacts (decisions, scores, rules applied, agent recommendations).
- Provide queryable reasoning traces for a node (ancestors, descendants, causal path).
- Record provenance: all graph updates link to ManifestSignature and AuditEvent entries.
- Support graph versioning and branching (snapshots, experiments, canary reasoning paths).
- Allow read-only views for auditors and CommandPad; write/update flows go through Kernel APIs only.
- Integrate with Eval Engine, Agent Manager, and SentinelNet to record recommendations and policy checks.
- Provide export for human-readable traces and machine-verifiable proofs (hashes/signatures).

---

# # Concepts & models (short)

## # ReasonNode
- `id` — uuid.
- `type` — enum (`observation|recommendation|decision|action|hypothesis|policyCheck|score`).
- `payload` — json: content depends on type (e.g., decision details, score vectors, policy rationale).
- `author` — string (agent id or system component).
- `createdAt` — timestamp.
- `version` — string (semantic version or graph snapshot id).
- `manifestSignatureId` — optional (link to the manifest that authorized this node).
- `auditEventId` — optional (link to the audit event that recorded creation).
- `metadata` — json (importance, confidence, tags).

## # ReasonEdge
- `id` — uuid.
- `from` — ReasonNode.id.
- `to` — ReasonNode.id.
- `type` — enum (`causal|supports|contradicts|derivedFrom|influencedBy`).
- `weight` — optional number (strength of causal link).
- `ts` — timestamp.

## # ReasonTrace
- A computed structure representing a path or DAG starting from a node and including ancestors/descendants, with steps annotated (`step`, `action`, `note`).

## # GraphSnapshot
- `id`, `createdAt`, `rootNodeIds[]`, `description`, `hash` (digest of snapshot), `signatureId`. Snapshots freeze a graph state for experiments or audits.

---

# # Minimal public API (intents)
These are what Kernel and UIs call (implement as service endpoints):

- `POST /reason/node` — create a new ReasonNode (Kernel-authorized only). Body contains node fields. Returns `nodeId` and `auditEventId`.
- `POST /reason/edge` — create an edge linking two nodes. Must reference existing node ids. Returns `edgeId`.
- `GET  /reason/node/{id}` — fetch node, metadata, and immediate in/out edges.
- `GET  /reason/trace/{id}?depth=N&direction=ancestors|descendants` — compute reasoning trace starting at node `id`. Returns ordered steps and included nodes/edges.
- `POST /reason/snapshot` — create a graph snapshot for audit/experiment. Returns `snapshotId` and hash.
- `GET  /reason/snapshot/{id}` — fetch snapshot details.
- `POST /reason/query` — powerful query (filters, tags, time ranges, confidence thresholds) returning node lists or subgraphs.
- `POST /reason/annotate/{id}` — add human annotation or note to a node (auditable).
- `GET  /reason/export/{id}?format=human|json|canonical` — export a trace or snapshot for auditors.

**Notes:** All creation endpoints must emit AuditEvent and produce ManifestSignature links when appropriate. Writes are strictly Kernel-authorized; agents may request writes via Kernel APIs.

---

# # Provenance, signing & immutability
- Every node and snapshot record must include links (`manifestSignatureId` or `auditEventId`) that prove authorization.
- Graph snapshots used for decisions must be hashed (canonicalized JSON → SHA-256) and signed by Kernel signer (store `signatureId`).
- Updates are append-only: node creation and edge creation are append operations. If correction is needed, create a new node marked as `correction` and link it to the original. All corrections are auditable.

---

# # Query & trace semantics
- Traces are **causal**: they show the chain of influence (e.g., observation → score → recommendation → decision → action).
- Queries support depth-limited traversal, breadth-first or depth-first ordering, and thresholds on `weight` or `confidence`.
- Traces must include human-friendly annotations: who wrote what, confidence, timestamp, and rationale text.
- The graph supports DAGs. Cycles are allowed but annotated; reasoning traversal must handle cycles gracefully (detect and stop loops, mark cycle).

---

# # Integration points
- **Eval Engine:** writes score nodes and recommendations; reasoning graph links scores → promote/demote decisions.
- **Agent Manager:** writes recommendations from agents as `recommendation` nodes and receives `decision` nodes that drive lifecycle actions.
- **SentinelNet:** records `policyCheck` nodes showing policy input, decision, and rationale. SentinelNet decisions must be linked to reason nodes for explainability.
- **Memory Layer & Audit Bus:** nodes reference memory artifacts; audit events record node creation.
- **CommandPad:** reads traces, can annotate, and can initiate multi-sig upgrade flows that create `decision` nodes.

---

# # Versioning & experiments
- Support graph snapshots for experiments: create snapshot IDs, run alternate reasoning (branch), and record differences. Snapshots are first-class (signed, hashed).
- Nodes include `version` so systems can run comparisons between reasoning produced by different model versions or policy sets.
- Allow tagging of nodes/edges with experiment or canary labels for later filtering.

---

# # Security & access control
- Reads: many traces are readable by auditors and Division Leads, but PII-sensitive payloads must be redacted per SentinelNet.
- Writes: only Kernel or authorized services can create nodes/edges. CommandPad annotations require elevated permissions.
- Signing: snapshots and important decision nodes must be signed; signer identity recorded.
- Data retention: snapshots retained per retention policy. Reasoning nodes older than retention may be archived; audit provenance must remain accessible.

---

# # Storage & implementation notes
- **Store hybrid:** authoritative node/edge metadata in Postgres (or graph DB), heavy payloads in S3 (if large). For high-performance traversals, use a graph database (Neo4j, JanusGraph) or a combination (Postgres + materialized edges).
- **Indexing:** index by `createdAt`, `author`, `type`, `tags`, and `confidence`. Precompute adjacency lists for fast traversal.
- **Canonicalization:** define canonical JSON for snapshots to ensure consistent hashing across systems. Include canonicalization reference in Audit spec.
- **Scalability:** shard by root graph or time range. Use caching for hot traces. Implement pagination and cursor-based traversal for deep graphs.

---

# # Safety & governance
- SentinelNet policies can prevent creation of nodes/edges that would violate governance (e.g., secret leakage). All policy denials produce `policyCheck` nodes describing the block.
- Human override must be explicit and recorded: CommandPad "override" creates an annotated node and requires multi-sig if changing governance-critical nodes.
- Rate-limit automated node creation to avoid graph floods; enforce quotas per agent/service.

---

# # Acceptance criteria (minimal)
- API endpoints exist and accept/reject writes only from Kernel (mTLS + RBAC).
- Node creation results in an AuditEvent linking node id to an audit record.
- Trace queries return ordered, annotated traces and handle cycles safely.
- Snapshots produce canonical hash + signature and can be verified.
- Integration: Eval Engine, Agent Manager, and SentinelNet can create/consume nodes and edges according to spec (or simulated in tests).
- Exports for auditors exist and are human-readable.
- Tests: unit tests for canonicalization/hashing, integration tests for trace queries and snapshot creation, and security tests for SentinelNet rejections.

---

# # Example flow (short)
1. Eval Engine writes `score` node for `agent-abc123` with payload `{score:0.82, model:"eval-v1"}`.
2. Eval emits `recommendation` node: `{recommend: "promote", reason:"score>0.8", confidence:0.9}` and links `score -> recommendation`.
3. Resource Allocator decision writes `decision` node `{action:"allocate extra gpus", reason:"roi positive"}` and links `recommendation -> decision`.
4. SentinelNet runs policy check, writes `policyCheck` node with `deny=false` and rationale, and links to `decision`.
5. Kernel records snapshot of the subgraph, hashes it, signs it, and emits an audit event. CommandPad can display the trace from `score` to `decision`.

---

End of file.

