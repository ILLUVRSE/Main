# Memory Layer — Core Module

## # Purpose
The Memory Layer provides persistent, auditable memory for ILLUVRSE: relational state (Postgres), semantic vectors (Vector DB), and large artifacts (S3). It is the canonical store for MemoryNodes, artifact metadata, embeddings, and provenance references used by Kernel, Agent Manager, and other platform services.

All writes must emit AuditEvents linking to manifestSignatureId and artifact checksums in order to preserve an auditable provenance chain.

## # Location
All files for the Memory Layer live under:
`~/ILLUVRSE/Main/memory-layer/`

## # Files in this module
- `memory-layer-spec.md` — canonical specification (data models, APIs, storage patterns, security, retention, and acceptance criteria).  
- `README.md` — this file.  
- `deployment.md` — deployment guidance and infra notes (to be created).  
- `api.md` — API surface and examples (to be created).  
- `acceptance-criteria.md` — testable checks for the Memory Layer (to be created).  
- `.gitignore` — local ignores for runtime files (to be created).

## # How to use this module
1. Read `memory-layer-spec.md` to understand canonical models, required Postgres schema, Vector DB indexing, and artifact metadata.  
2. Implement or integrate services that provide documented public interfaces: `createMemoryNode`, `storeEmbedding`, `searchEmbedding`, `putArtifact`, `getArtifactMetadata`.  
3. On each write:
   * Persist metadata in Postgres and vector in Vector DB.  
   * Attach manifestSignatureId and artifact checksum.  
   * Emit AuditEvent with `hash`, `prevHash`, `signature`, and provenance pointers so the audit chain can be verified.  
4. Enforce TTL, legal-hold, and PII flags; provide soft-delete semantics and legal-hold exceptions.

## # Security & compliance
- TLS everywhere and encryption-at-rest required.  
- RBAC must be enforced for read/write operations; Kernel/authorized services only for certain actions.  
- PII must be flagged and read operations must be restricted or redacted per SentinelNet policy.  
- Archive audit events to S3 with object-lock for immutability.

## # Observability & recovery
- Expose ingestion rate, vector write latency, search latency (p95), queue depth, and worker error rate.  
- Provide tracing that includes memoryNodeId, traceId, and caller.  
- Test backup/restore for Postgres and Vector DB, and replay of audit archives to rebuild metadata.

## # Acceptance & sign-off
Memory Layer is accepted when:
* Postgres schema (`memory_nodes`, `artifact` and indexes) implemented and tested.  
* Vector DB index and embedding pipeline function and idempotency guaranteed.  
* Artifact uploads produce checksums stored in Postgres and linked audit events.  
* Retention, TTL, and legal-hold behavior works in tests.  

Final approver: **Ryan (SuperAdmin)**. Security Engineer should review encryption, PII handling, and KMS/Vault integration.

## # Next single step
Create `deployment.md` for the Memory Layer (one file) describing Postgres schema migrations, Vector DB provisioning, and S3 bucket policies (versioning + object-lock). When ready, reply **“next-memory-layer”** and I’ll generate the exact content for that file.

