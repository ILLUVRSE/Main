# Memory Layer — Core Module

# # Purpose
The Memory Layer provides persistent, auditable memory for ILLUVRSE: relational state (Postgres), semantic vectors (Vector DB), and large artifacts (S3). It is the single place agents and services store and query persisted knowledge, embeddings, and artifacts.

# # Location
All files for the Memory Layer live under:
~/ILLUVRSE/Main/memory-layer/


# # Files in this module
- `memory-layer-spec.md` — the canonical specification (data models, APIs, storage patterns, security, retention, and acceptance criteria).
- `README.md` — this file.
- `deployment.md` — deployment guidance and infra notes (to be created).
- `api.md` — API surface and examples (to be created).
- `acceptance-criteria.md` — testable checks for the Memory Layer (to be created).
- `.gitignore` — local ignores for runtime files (to be created).

# # How to use this module
1. Read `memory-layer-spec.md` to understand the authoritative models and behavior.
2. Implement or integrate services that provide the documented public interfaces (createMemoryNode, storeEmbedding, searchEmbedding, putArtifact, etc.).
3. Ensure all writes that affect provenance or manifests emit audit events via the Kernel audit bus.
4. Enforce TTL, legal hold, and PII handling as described in the spec.
5. Use Postgres for authoritative joins and metadata, Vector DB for vectors, and S3 for artifacts; implement joins and caching for performance.

# # Security & compliance
- TLS everywhere and encryption-at-rest required.
- RBAC must be honored for read/write operations; PII must be flagged and access restricted.
- Secrets and keys handled by Vault/KMS; do not store secrets in repo or DB.
- All write operations must emit audit events for provenance and verification.

# # Acceptance & sign-off
Memory Layer is accepted when:
- Postgres schema and Vector DB integration implemented and tested.
- Embedding pipeline ingests documents, stores vectors, and returns correct search results.
- Retention / TTL and legal hold behavior works in tests.
- Audit events are emitted with manifestSignatureId and caller information.
Final approver: **Ryan (SuperAdmin)**. Security Engineer should review encryption, PII handling, and key management.

# # Next single step (one-file)
Create `deployment.md` for the Memory Layer (one file). When you’re ready, reply **“next”** and I’ll give the exact content for that single file.

---

End of README.

