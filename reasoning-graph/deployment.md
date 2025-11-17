# Reasoning Graph — Deployment & Production Runbook

**Purpose**
Deployment and operational guidance for Reasoning Graph. Covers topology, transport security (mTLS), signing/KMS, RBAC, storage & snapshot export, scaling, SLOs, canary rollout, DR and CI guardrails. Follow this for production deployments.

**Audience:** SRE / Ops / Security / Release Engineer

---

## 1 — Architecture / topology (high level)

```
Kernel (mTLS) --> Reasoning Graph service (API / worker)
                      ├─ Postgres (primary store)
                      ├─ Snapshot store (S3 / MinIO with object-lock)
                      ├─ Signing service (KMS / signing-proxy)
                      └─ Observability backend (Prometheus / Tracing)
Clients (Control-Panel, Eval Engine, SentinelNet, Agent Manager) --> Kernel --> Reasoning Graph
```

**Principles**

* **Writes only through Kernel:** All state-changing calls must be mediated by Kernel (mTLS or kernel-signed tokens). Reasoning Graph must reject direct unauthenticated writes. 
* **Signed snapshots & audit linkage:** Snapshots and important trace artifacts must be canonicalized, hashed, signed, and reference audit events. Use Kernel verifier registry patterns for public keys. 
* **PII protection:** Redaction policies enforced before returning traces to non-authorized principals.

---

## 2 — Required environment variables

Store all secrets in Vault / secret manager (do not commit).

**Core**

* `NODE_ENV=production`
* `PORT`
* `DATABASE_URL`
* `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET` (for snapshot export)
* `KERNEL_API_URL` (Kernel base URL)
* `KERNEL_CLIENT_CERT` and `KERNEL_CLIENT_KEY` (if using mTLS); OR `KERNEL_API_TOKEN` (server-side token; prefer mTLS)
* `REQUIRE_MTLS=true` (production guard)
* `REQUIRE_KMS=true` or `SIGNING_PROXY_URL` (production signing guard)
* `SIGNING_PROXY_API_KEY` (if using signing proxy)
* `AUDIT_SIGNER_KID` (signer id)
* `CONTROL_PANEL_SIGNER_KID` (optional for operator-side snapshots)
* `PROM_ENDPOINT` / `PROM_PUSH_GATEWAY`
* `OTEL_COLLECTOR_URL` (for tracing)

---

## 3 — Transport security (mTLS / tokens)

**Production requirement:** mTLS recommended between Kernel ↔ Reasoning Graph. If mTLS is not available, use server-side tokens with tight rotation and minimal scope.

**mTLS details**

* Provision short-lived client certs via Vault PKI or internal CA. Mount via CSI driver or injected as kube secrets with restricted RBAC.
* Health endpoints should surface `mTLS=true/false` and certificate expiry.

**CI / Staging**

* `DEV_SKIP_MTLS=true` only for dev; server must fail startup if `NODE_ENV=production` and `DEV_SKIP_MTLS=true`.

---

## 4 — Signing & canonicalization

**Signing model**

* Snapshots must be canonicalized using the canonicalization rules shared with Kernel. Maintain parity tests (Node ↔ Go) to ensure byte-for-byte equality. See Kernel canonical parity test for an example approach. 
* Sign snapshots via:

  * **KMS/HSM** (recommended): call KMS Sign with `MessageType: 'DIGEST'` for digest signing. See KMS IAM and operational guidance. 
  * **Signing proxy:** for organizations with a signing proxy service, call `SIGNING_PROXY_URL` over mTLS/private network.

**Signer registry**

* Publish public keys to Kernel verifier registry (`kernel/tools/signers.json`) before deprecating keys. See signer JSON examples for format. 

**Canonicalization parity**

* Add parity vector tests and a `node_canonical_parity.test.js` equivalent. Keep `test/vectors/canonical_vectors.json` in repo to freeze vectors.

---

## 5 — Storage & snapshot export

**Snapshot store**

* Use S3 (or MinIO) with **Object Lock** for auditor snapshots. Snapshots must be exported with metadata: `{ snapshot_id, trace_range, hash, signer_kid, signature, ts }`.

**Export process**

* Provide `reasoning-graph/tools/export_snapshots.ts` that:

  * Exports snapshots in gzipped JSONL batches
  * Writes to `s3://<audit-archive>/reasoning-graph/<env>/<ts>.jsonl.gz`
  * Sets object-lock retention policy per compliance

**Replay / verify**

* Provide a `verifySnapshot.ts` to re-canonicalize snapshots and verify signatures using public keys. Ensure `kernel/tools/audit-verify.js` can be used to validate audit chains.

---

## 6 — PII redaction & access control

**Policy**

* Implement PII classification and redaction pipeline so any trace returned to non-privileged principals has PII removed or masked.
* Provide `reasoning-graph/docs/PII_POLICY.md` documenting classification, retention, and redaction rules.

**Testing**

* Unit tests exercising redaction on nested structures and annotations.

---

## 7 — Database & schema

**Postgres**

* Use Postgres with WAL archiving and PITR enabled. Use separate schemas/tables:

  * `reasoning_nodes`, `reasoning_edges`, `traces`, `snapshots`, `annotations`
* Migrations must be idempotent and applied via CI/CD with `db migrate` jobs.

**Indexes**

* Index by `trace_id`, `created_at`, and relation keys for efficient traversal.

---

## 8 — Observability & SLOs

**Metrics**

* `reasoning_graph.trace_query_latency_seconds` (histogram)
* `reasoning_graph.snapshot_generation_seconds` (histogram)
* `reasoning_graph.snapshots_total` (counter)
* `reasoning_graph.canonicalization_failures_total` (counter)

**SLOs**

* Trace query p95 (dev < 200ms; prod target < 50ms).
* Snapshot generation p95 < 5s for small traces; set sizing guidance for large traces.

**Tracing**

* Inject trace IDs into audit payloads for end-to-end traceability. Export spans to OTEL collector.

---

## 9 — Canary & rollout strategy

**Canary steps**

1. Deploy to a canary namespace with 5–10% traffic (DNS split / LB).
2. Run smoke tests: trace generation, snapshot signing, audit emission, and explain queries.
3. Monitor metrics (latency, errors) and canonicalization mismatch rates.
4. Roll forward when metrics stable; auto-rollback on failures.

**Multisig/policy gating**

* For changes that affect signing or canonicalization, require Kernel multisig approvals.

---

## 10 — Scaling & resilience

**Scale patterns**

* Stateless API servers behind Load Balancer; scale horizontally.
* Snapshot generation performed by worker pool (queue-based) to avoid blocking queries.
* Leader election for any single-writer obligations (e.g., snapshot compaction).

**Failure modes**

* If snapshot worker fails, keep snapshots in pending state and retry with exponential backoff; ensure idempotent snapshot generation.

---

## 11 — Backup & DR

**DR procedures**

* Regular DB backups + WAL archiving. Test PITR restore monthly.
* Snapshot export to S3 (object lock) is part of compliance DR.
* DR drill: restore DB in test cluster and run snapshot verification scripts to ensure signatures reproduce.

---

## 12 — CI & guardrails

**CI checks**

* Unit tests & canonical parity tests.
* Integration tests with Kernel mock to verify Kernel-only write constraints and audit linkage.
* `./scripts/ci/check-no-private-keys.sh` run on PRs.
* For protected branches, require KMS availability or signing-proxy reachable (`REQUIRE_KMS` guard).

**Suggested pipeline jobs**

* `reasoning-graph-ci.yml`:

  * lint, unit tests
  * canonical parity test
  * integration tests with Kernel mock
  * audit verify on generated snapshots (best-effort)

---

## 13 — Health endpoints & diagnostics

**Endpoints**

* `GET /health` — overall health + transport summary (`kernelConfigured`, `mTLS=true/false`, `signingConfigured`)
* `GET /ready` — readiness: DB ping, Kernel probe, snapshot store probe
* `GET /metrics` — Prometheus text format

**Recommended health output**

```json
{
  "ok": true,
  "mTLS": true,
  "kernelConfigured": true,
  "signerConfigured": true,
  "uptime": 12345
}
```

---

## 14 — Key rotation & signer lifecycle

**Process**

1. Create new KMS key or signing proxy signer.
2. Export public key and add to Kernel’s verifier registry (`kernel/tools/signers.json`) before using. 
3. Deploy Reasoning Graph referencing new signer. Verify snapshot verification works across new and old keys.
4. Deprecate old key after overlap period.

**Validation**

* Run snapshot verify against a sample snapshot using new public key.

---

## 15 — Emergency procedures

**If canonicalization mismatch occurs**

* Stop snapshot signing and mark snapshots as `on_hold`. Investigate parity vectors. Run the canonical parity test locally and compare vectors. Revert to previous release if necessary.

**If signing fails**

* Fail closed: stop snapshot publication until KMS/signing-proxy healthy. Never publish unsigned snapshots for auditors.

**If Kernel unreachable**

* Mark service as read-only; reject write requests and queue local writes only if safe. Notify Kernel on-call.

---

## 16 — Commands & diagnostics

```bash
# run unit tests & parity
cd reasoning-graph
npm ci
npx jest --runInBand

# run integration (local)
./run-local.sh

# check health
curl -sS http://localhost:PORT/health | jq

# verify snapshot signature (example)
node tools/verifySnapshot.js --snapshot-id <id> --public-key /tmp/pub.pem
```

---

## 17 — Promotion checklist before production

* [ ] `REQUIRE_MTLS=true` enforced in production.
* [ ] KMS or signing-proxy configured and reachable (`REQUIRE_KMS=true` / `SIGNING_PROXY_URL`) and verified.
* [ ] Canonical parity tests passing (Node/Go parity where applicable). 
* [ ] Snapshot export & object-lock configured and tested.
* [ ] Audit emission & `audit-verify` passes for sample snapshots. 
* [ ] PII policy reviewed and implemented; redaction tested.
* [ ] Metrics & tracing validated.
* [ ] Runbook & DR procedures exercised (tabletop).
* [ ] Security review completed and signed.

---

## 18 — References

* Kernel canonicalization & parity test examples (use for parity): `kernel/test/node_canonical_parity.test.js`. 
* Signing / signers registry & examples: `kernel/tools/signers.json`. 
* Audit verification utility: `kernel/tools/audit-verify.js` for verifying audit chains. 

---
