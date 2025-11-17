# Reasoning Graph — Acceptance Criteria (Final)

**Purpose:** precise, testable acceptance gates proving the Reasoning Graph accepts Kernel-authorized writes, produces explainable ordered traces, creates signed snapshots for auditors, integrates with Eval Engine / SentinelNet / Agent Manager, and is auditable. Final approver: **Ryan (SuperAdmin)**. Security & Kernel teams must review signing and PII policies. (See `reasoning-graph/README.md`.) 

---

## How to run verification (quick)

Run these locally or in CI against a test Kernel (or the Kernel mock) and dependent service mocks:

```bash
# from repo root (adjust for your language/toolchain)
cd reasoning-graph
npm ci        # or go build / make build, depending on implementation
# unit tests
npm test
# run integration/acceptance tests
# for Go: go test ./internal/acceptance -run TracePromotion
# for Node: npx jest --runInBand reasoning-graph/test/integration
# optional: ./run-local.sh to spin up Kernel mock + Reasoning Graph + Eval Engine mocks
```

All acceptance tests must pass in CI for signoff.

---

## Files that must exist

A PR is incomplete if any of these files are missing.

* `reasoning-graph/acceptance-criteria.md` *(this file)*
* `reasoning-graph/README.md` *(exists — quick reference)*. 
* `reasoning-graph/reasoning-graph-spec.md` — canonical models (ReasonNode, ReasonEdge, ReasonTrace, Snapshot)
* `reasoning-graph/api.md` — API surface for node/edge writes, trace queries, snapshot creation & verification
* `reasoning-graph/deployment.md` — topology, signing requirements, RBAC, storage & snapshot export guidance
* `reasoning-graph/acceptance-tests/` — integration/acceptance test suite (see tests below)
* `reasoning-graph/test/vectors/canonical_vectors.json` — canonicalization vectors for canonical Marshal tests
* `reasoning-graph/run-local.sh` — local orchestration (Kernel mock, migrations, run tests)
* `reasoning-graph/.gitignore` — local runtime ignore for generated files & local secrets

If any item above is missing, add it before requesting final sign-off.

---

## Acceptance criteria (blocking items first)

### 1) Kernel-authenticated writes only (blocking)

**Acceptance**

* All write APIs (`POST /nodes`, `POST /edges`, `POST /traces`) must accept only Kernel-authenticated requests (mTLS or Kernel-signed bearer tokens).
* Requests from non-Kernel principals must be rejected (`401/403`).

**How to verify**

* Unit tests for RBAC middleware asserting write routes reject unauthenticated requests.
* Integration test: start a Kernel mock that issues a valid server token; assert writes succeed only from the Kernel mock.

**Files / tests**

* `reasoning-graph/test/integration/auth.test.*` — tests for mTLS/token flows.

---

### 2) Trace model correctness & ordered causal paths (blocking)

**Acceptance**

* ReasonTrace queries must return an ordered, annotated causal path for a given root node or event. The API must handle cycles safely (detect and break cycles for representation).
* Each returned trace node must include: node id, type, timestamp(s), rationale, references to audit events (hash/signature), and any annotations.

**How to verify**

* Unit tests using synthetic traces assert ordering & cycle-safety.
* Integration test: ingest a sequence of nodes/edges that represent a decision chain and assert the queried `GET /traces/{id}` returns the expected ordered path with annotations.

**Files / tests**

* `reasoning-graph/test/integration/trace_ordering.test.*`

---

### 3) Snapshot signing & canonicalization (blocking)

**Acceptance**

* The service must produce signed snapshots (a canonicalized JSON representation of a trace or graph range) and attach a signature + signer KID + timestamp.
* Canonicalizer must match Kernel canonicalization rules (byte-for-byte parity). Provide canonicalization vectors and a parity test (Node ↔ Go if multi-language implementation exists).

**How to verify**

* Provide `test/vectors/canonical_vectors.json` and parity test similar to `kernel/test/node_canonical_parity.test.js`. Run parity test:

  ```bash
  # Node parity test (example)
  npx jest reasoning-graph/test/node_canonical_parity.test.js --runInBand
  ```
* Snapshot generation test: call `POST /snapshots` → returns `{ snapshot_id, hash, signer_kid, signature }` and verify signature with public key exported from KMS / signing proxy.

**Files / tests**

* `reasoning-graph/test/node_canonical_parity.test.js` (or go equivalent)
* `reasoning-graph/test/integration/snapshot_signing.test.*`

**Notes**

* The Kernel canonicalization rules are the canonical reference. Use the same canonicalization logic as Kernel (or ensure parity). 

---

### 4) Audit linkage & verifiability (blocking)

**Acceptance**

* Every write or snapshot must produce an AuditEvent (sha256, prevHash, signature, signer_kid) or reference a kernel-signed manifest that is stored in the audit stream.
* Reasoning Graph must include references to the audit events it depends on, so an auditor can replay or verify the causal chain.

**How to verify**

* After test flows, run `kernel/tools/audit-verify.js` against audit events referenced by Reasoning Graph to ensure chain integrity. Example:

  ```bash
  node kernel/tools/audit-verify.js -d "postgres://postgres:postgres@localhost:5432/illuvrse" -s kernel/tools/signers.json
  ```
* Tests should create nodes, edges, and snapshots, then run audit verification. 

---

### 5) Explainability & annotations (blocking)

**Acceptance**

* API must expose `GET /node/{id}/explain` or `GET /trace/{id}/explain` which returns human-readable rationale alongside causal structure and evidence refs.
* Operators must be able to annotate nodes (persisted corrections) and annotations must themselves be append-only and auditable.

**How to verify**

* Integration tests: add annotations via UI/API and assert they appear in explain view and generate audit events.

---

### 6) Multiservice integration (blocking)

**Acceptance**

* Reasoning Graph must integrate with:

  * **Kernel** for RBAC, audit emission, and manifest references.
  * **Eval Engine / Agent Manager** for recording recommendations and runtime actions.
  * **SentinelNet** for policy evaluation references.
* End-to-end test: produce a PromotionEvent (via Eval Engine mock), Reasoning Graph must record nodes/edges and produce a signed snapshot and audit events.

**How to verify**

* Integration acceptance test: start Kernel mock + Eval Engine mock + SentinelNet mock → trigger a promotion → assert Reasoning Graph records reason nodes, emits snapshot, and that Kernel audit contains links to the snapshot.

**Files / tests**

* `reasoning-graph/test/integration/promotion_integration.test.*`

---

### 7) PII protection & redaction (blocking)

**Acceptance**

* Reasoning Graph must implement PII redaction policies: traces returned to non-authorized principals must have PII redacted per SentinelNet policies. PII must not leak into signed snapshots for auditors unless the auditor is authorized and the snapshot is designated for that audience.

**How to verify**

* Unit tests for `piiRedaction` middleware.
* Integration tests that fetch traces with/without `read:pii` capability and assert differences.

---

### 8) Storage, snapshot export & retention (P1)

**Acceptance**

* Snapshots and audit references must be exportable to S3 (object-lockable) for auditor storage. Provide `reasoning-graph/tools/export_snapshots.ts` or script.
* Retention & TTL must be configurable.

**How to verify**

* Run export tool to S3 dev/minio and verify object-lock metadata and replay ability.

---

### 9) Observability & performance SLOs (P1)

**Acceptance**

* Endpoints to expose metrics:

  * `reasoning_graph.trace_query_latency_seconds` (histogram)
  * `reasoning_graph.snapshot_generation_seconds` (histogram)
  * `reasoning_graph.snapshots_total` (counter)
* Provide a local load test to measure p95 (< 200ms dev; target <50ms production per README).

**How to verify**

* Unit smoke test for `/metrics` and a load harness that measures p95 (see `sentinelnet` SLO notes for analogous test). 

---

### 10) Tests & automation (blocking)

* **Unit tests:** canonicalization, storage, PII redaction, RBAC.
* **Node↔Go canonical parity test** (if multi-language) — must pass or skip if Go not installed. (Mirror Kernel parity test approach.) 
* **Integration tests:** promotion → reason node creation → snapshot signing → audit verify.
* **CI job:** `.github/workflows/reasoning-graph-ci.yml` runs unit + integration + audit verification.

---

## Documentation required (blocking)

* `reasoning-graph/api.md` — endpoints, schemas, examples.
* `reasoning-graph/deployment.md` — topology, mTLS/RBAC requirements, signer & KMS guidance, snapshot export.
* `reasoning-graph/.gitignore` — local runtime excludes for generated snapshots and local secrets.
* `reasoning-graph/docs/PII_POLICY.md` — PII classification & redaction rules.

---

## Final acceptance checklist (copy into PR)

Mark items **PASS** only when tests pass and docs exist.

* [ ] `reasoning-graph/README.md` up-to-date. 
* [ ] `reasoning-graph/api.md` present and accurate.
* [ ] Canonicalization parity test present & passing (or skipped with reason).
* [ ] Snapshot signing implemented and proofs verifiable with public keys registered in Kernel verifier registry.
* [ ] Every write produces audit references and audit chain verifies.
* [ ] Trace explainability and annotations working with tests.
* [ ] PII redaction enforced and tested.
* [ ] Integration test with Eval Engine / SentinelNet passes.
* [ ] Metrics exposed and p95 measured (dev load harness).
* [ ] `.gitignore` present.
* [ ] Security review for signing & PII completed and signed.
* [ ] Final sign-off: **Ryan (SuperAdmin)**.

---

## Minimal reviewer commands

```bash
# run unit & parity tests
cd reasoning-graph
npm ci && npm test

# run parity test (if provided)
npx jest test/node_canonical_parity.test.js --runInBand

# run integration acceptance
# (example for Go: go test ./internal/acceptance -run Promotion)
# for Node:
npx jest test/integration --runInBand

# verify audit chain for events referenced by reasoning-graph
node ../kernel/tools/audit-verify.js -d "postgres://postgres:postgres@localhost:5432/illuvrse" -s ../kernel/tools/signers.json
```

---

## Notes & references

* Reasoning Graph must align with Kernel canonicalization and audit model. Use Kernel canonicalization tests as a template for parity. 
* Signing and proof formats must match Kernel verifier expectations: `kernel/tools/signers.json` and `kernel/tools/audit-verify.js` are the canonical references.  

---
