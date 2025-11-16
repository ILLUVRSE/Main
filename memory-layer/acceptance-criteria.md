# Memory Layer — Acceptance Criteria (Strict / Testable)

This file defines the exact, automatable acceptance gates the Memory Layer must satisfy before frontend teams can build on it and before final sign-off is recorded.

> Each item is phrased as a concrete check and includes the canonical place in the repo where the implementation or test lives. Mark items **GREEN** only when the check passes in CI or in a staging environment.

---

## How to run the verification (quick)

Run these locally or in CI against a test Postgres instance and a signing service (mock-kms or real KMS).

```bash
# 1. Build & migrate (run in memory-layer directory)
npm ci
npm run memory-layer:build
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/illuvrse \
  npx ts-node memory-layer/scripts/runMigrations.ts memory-layer/sql/migrations

# 2. Start mock signer (devops/mock-kms), then start service
# CI workflow (.github/workflows/ci-memory-layer.yml) automates this.
node ./dist/memory-layer/service/server.js &

# 3. Run integration suite
DATABASE_URL=... npm run memory-layer:test:integration
```

---

## Acceptance checklist (blocking items first)

### A. Schema & transactional guarantees (P0 — blocking)

1. **Postgres schema exists and migrations are idempotent**

   * Files: `memory-layer/sql/migrations/001_create_memory_schema.sql`, `002_enhance_memory_vectors.sql`

   * Check: `memory-layer/scripts/runMigrations.ts` runs without error and `schema_migrations` contains the migration IDs.

   * Command:

     ```bash
     DATABASE_URL=... npx ts-node memory-layer/scripts/runMigrations.ts memory-layer/sql/migrations
     ```

   * Pass when: migrations apply and re-run is a no-op.

2. **Atomic node+artifact+audit writes**

   * File: `memory-layer/service/db.ts` (`insertMemoryNodeWithAudit` implementation).
   * Check: Create node + artifact via `POST /v1/memory/nodes` and ensure `memory_nodes` row exists only if a corresponding `audit_events` row exists with matching `hash`/`prev_hash`.
   * Test: Integration test `memory-layer/test/integration/ingest_search_artifact.test.ts` must pass.
   * Pass when: DB shows atomicity and integration test green.

3. **Audit digest + prev_hash chaining correctness**

   * Files: `memory-layer/service/audit/auditChain.ts`, `memory-layer/service/audit/verifyTool.ts`
   * Check: `npx ts-node memory-layer/service/audit/verifyTool.ts` returns exit code 0 for a sampled range of audit rows.
   * Pass when: `verifyTool` reports "all rows OK."

4. **Insert audit event must fail the transaction if signing fails when `REQUIRE_KMS=true` or `NODE_ENV=production`**

   * Files: `memory-layer/service/db.ts`, `memory-layer/service/server.ts` (startup guard)
   * Check: Start server with `REQUIRE_KMS=true` and no signer — server must refuse startup. In a running server with `REQUIRE_KMS=true`, artificially cause signer to fail and ensure an attempted write rolls back and returns an error.
   * Pass when: server refuses start without signer and write operations roll back on signing failure.

---

### B. Signing & KMS (P0 — blocking)

5. **Digest-path signing implemented & exercised**

   * Files: `memory-layer/service/audit/auditChain.ts`, `memory-layer/service/audit/kmsAdapter.ts`, `memory-layer/service/audit/signingProxyClient.ts`
   * Check: When `AUDIT_SIGNING_KMS_KEY_ID` or `SIGNING_PROXY_URL` is configured, `insertAuditEvent` stores `signature` and `manifest_signature_id` as applicable. `auditReplay.verifyTool` verifies signatures.
   * Pass when: Integration tests verify signatures or `verifyTool` says signatures are valid.

6. **Audit archival to S3 with Object Lock (COMPLIANCE)**

   * Files: `memory-layer/tools/auditReplay.ts`, infra docs `infra/audit-archive-bucket.md`
   * Check: Audit export job writes to `illuvrse-audit-archive-${ENV}` with Object Lock enabled, and a restore + `auditReplay` dry run succeeds.
   * Pass when: DR drill completes and `auditReplay` verifies hashes/signatures.

---

### C. Vector & embedding pipeline (P0 — blocking)

7. **Vector DB idempotent writes + queue fallback**

   * Files: `memory-layer/service/vector/vectorDbAdapter.ts`, `memory-layer/service/worker/vectorWorker.ts`
   * Check: For `VECTOR_DB_PROVIDER=postgres` seeded vectors produce deterministic search results. For an external provider, cause the external write to fail; verify a `memory_vectors` row is created with `status='pending'` and that `vectorWorker` processes it later to `completed`.
   * Pass when: `vectorWorker` replays pending rows and external provider success updates `external_vector_id`.

8. **Search SLO verification**

   * Files: `memory-layer/service/vector/vectorDbAdapter.ts`, `memory-layer/test/integration/ingest_search_artifact.test.ts`
   * Check: Seed vectors and measure p95 search latency. Define target (e.g., p95 < 200ms for small test dataset).
   * Pass when: CI reports p95 under target.

---

### D. Artifact & provenance (P0 — blocking)

9. **Artifact checksum validation & mapping to audit events**

   * Files: `memory-layer/service/storage/s3Client.ts`, `memory-layer/service/services/memoryService.ts`
   * Check: `POST /v1/memory/artifacts` computes SHA-256 by streaming the object and rejects on mismatch. Audit row references artifact id and contains `manifest_signature_id`.
   * Pass when: Integration test for artifact ingest passes and audit row present.

10. **PII flags and redaction**

    * Files: `memory-layer/service/middleware/piiRedaction.ts`, `memory-layer/service/routes/memoryRoutes.ts`
    * Check: Create a MemoryNode with `piiFlags` set. Request `GET /v1/memory/nodes/:id` as a principal without `read:pii` and confirm `piiFlags` is stripped. Also test stringified JSON responses and nested PII.
    * Pass when: Redaction behavior verified by tests.

---

### E. TTL / legal-hold (P0 — blocking)

11. **TTL cleaner soft-delete + signed audit event inside same transaction**

    * Files: `memory-layer/service/jobs/ttlCleaner.ts`
    * Check: Set a node with small TTL, let `ttlCleaner` run or run one-shot; ensure node `deleted_at` set and audit event inserted with `hash`/`signature`. Ensure legal hold prevents deletion.
    * Pass when: `ttlCleaner` test passes and audit entry verified.

---

### F. Observability & operations (P1)

12. **Metrics exposed & SLO dashboards**

    * Files: `memory-layer/service/observability/metrics.ts`, `/metrics` endpoint in `server.ts`
    * Check: `/metrics` returns Prometheus metrics; required metrics exist (`memory_search_seconds`, `memory_vector_write_seconds`, `memory_vector_queue_depth`, `memory_audit_sign_failures_total`). Configure a dashboard and validate p95 panels.
    * Pass when: `/metrics` endpoint present and dashboard queries return values.

13. **Tracing & trace-injection into audit payloads**

    * Files: `memory-layer/service/observability/tracing.ts`, `memory-layer/service/services/memoryService.ts` (audit injection)
    * Check: Tracing enabled in staging; traces correlate request → audit events (audit `_trace` field contains `traceId`). End-to-end trace from ingest → vector upsert → audit should be visible in the tracing backend.
    * Pass when: `injectTraceIntoAuditPayload` results visible in audit payloads and traces can be joined.

14. **Health & readiness semantics**

    * Files: `memory-layer/service/server.ts` (`/healthz`, `/readyz`)
    * Check: `/healthz` fails when DB is down; `/readyz` fails if migrations missing. Liveness/readiness probes return proper codes.
    * Pass when: Probe behavior matches spec.

---

### G. CI / automation (P1)

15. **E2E CI runs migrations + tests + signing**

    * Files: `.github/workflows/ci-memory-layer.yml` (provided), `memory-layer/ci/run_in_ci.sh`
    * Check: GitHub Actions job `CI — Memory Layer` passes on PRs to `main` and enforces `REQUIRE_KMS=true` in CI so signing path is tested. Integration tests must run in the job.
    * Pass when: CI job green and logs show signed audit events.

16. **Audit verification tooling in CI**

    * Files: `memory-layer/service/audit/verifyTool.ts`, `memory-layer/tools/auditReplay.ts`
    * Check: CI or a scheduled job runs `verifyTool` against recent audit rows or the archived audit objects to ensure chain integrity.
    * Pass when: `verifyTool` passes in CI or on DR runs.

---

### H. Security & governance (P2)

17. **Secrets via Vault / secrets manager**

    * Files: `memory-layer/deployment.md` (instructions)
    * Check: No sensitive keys in repo or image; CI/deploy uses Vault secret injection for KMS keys, DB URL, S3 keys, signing proxy API key.
    * Pass when: Audit of images and repo shows no secrets and deploys use secret manager.

18. **Production guardrails: OpenAPI validator + signing enforcement**

    * Files: `memory-layer/service/server.ts`, `memory-layer/api/openapi.yaml`, `memory-layer/package.json` (validator pinned)
    * Check: In production image the Validator package is present and `OPENAPI_SPEC_PATH` is set. Server fails startup if validator or signer missing.
    * Pass when: Production image refuses to start without validator/signing or CI demonstrates strict behavior.

19. **Audit archival policy & object-lock validation**

    * Files: `infra/audit-archive-bucket.md`, `memory-layer/tools/auditReplay.ts`
    * Check: Audit archive bucket has Object Lock and lifecycle. Run DR drill and verify replay.
    * Pass when: DR drill passes.

---

### I. QA & final sign-off (P3)

20. **Runbook & SRE checklist written and tested**

    * Files: `memory-layer/deployment.md` (runbook section)
    * Check: On-call SRE can execute incident runbook steps (KMS outage, vector outage, S3 restore). Run a simulated incident drill.
    * Pass when: Run

