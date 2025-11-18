# Eval Engine & Resource Allocator — Audit Log Specification

**Purpose**
Specifies the AuditEvent JSON schema, signing/canonicalization rules, atomic write requirements, archival and replay procedures, and verification commands required for acceptance. All audit events emitted by Eval Engine and Resource Allocator must conform to this spec so `kernel/tools/audit-verify.js` and other repo tools can validate them.

---

## 1 — Principles (summary)

* **Append-only**: Audit events are append-only; events may not be mutated in-place. Corrections are implemented via new events that reference prior events.
* **Atomicity**: State changes and emission of the corresponding AuditEvent must be atomic — either both persist, or neither.
* **Chaining**: Every AuditEvent must include `prevHash` referencing the prior event’s `hash` for that logical chain.
* **Canonicalization**: Event bytes must be canonicalized deterministically before hashing and signing. Use agreed canonical JSON (sorted keys, stable formatting) per Kernel canonicalizer.
* **Signing**: Sign only the digest (SHA-256) of the canonicalized bytes using KMS/HSM or signing proxy. Never store private keys in the repo.
* **Archival**: Audit archives are stored in S3 with Object Lock (COMPLIANCE) and versioning enabled.
* **Verification**: Provide tooling to replay and verify chains (`kernel/tools/audit-verify.js`, `memory-layer/service/audit/verifyTool.ts`).

---

## 2 — AuditEvent JSON schema (required fields)

All AuditEvents MUST be JSON objects with the following minimal structure. Events may include additional module-specific fields in `payload` or `meta`, but required fields must exist.

```json
{
  "ok": true,
  "eventId": "av-000000000000001",         // unique id (uuid or monotonic)
  "eventType": "string",                   // e.g., "eval.submit", "promotion.request", "allocation.settle"
  "actor": "service:eval-engine|operator:alice@example.com",
  "ts": "2025-11-20T15:00:00Z",            // ISO8601 UTC
  "payload": { "domain": "object" },       // domain-specific structured payload
  "prevHash": "hex-previous-sha256",       // hex string of previous event hash in same chain (or null for chain start)
  "hash": "hex-current-sha256",            // hex string of this event's SHA-256 digest of canonical bytes
  "signer_kid": "signer-id-v1",            // signer id used for this signature
  "signature": "base64-or-armor",          // cryptographic signature over `hash` or canonical bytes per org policy
  "manifestSignatureId": "manifest-sig-abc", // optional, when audit references a manifest
  "meta": { "module": "eval-engine", "env": "staging" } // optional metadata
}
```

**Notes**

* `eventId` unique within platform; recommended UUIDv4 with prefix `av-`.
* `prevHash` is the hex SHA-256 of the *preceding* AuditEvent in the same logical audit log. For chain start, use `null` or an empty string `""` (but be consistent).
* `hash` is always the hex-encoded SHA-256 of the canonicalized AuditEvent *body* excluding the `signature` field. See canonicalization rules below.
* `signature` is computed over `hash` (recommended) or over canonical bytes depending on KMS semantics — be explicit in `meta` if signing semantics deviate.
* `signer_kid` must correspond to a key published in Kernel verifier registry (`kernel/tools/signers.json`).

---

## 3 — Canonicalization rules

To ensure byte-for-byte parity across languages and implementations, follow these canonicalization rules:

1. **Canonical JSON**:

   * Use UTF-8 encoding.
   * Remove all insignificant whitespace (no spaces, line breaks) except those inside string values.
   * Serialize object keys sorted lexicographically (unicode codepoint order).
   * Arrays preserve order.
   * Booleans use `true` / `false`, numbers use decimal representation without extraneous leading zeros.
2. **Canonical Event Body for Hash**:

   * Create a copy of the AuditEvent object with the `signature` field **removed** (or set to `null`) before canonicalization.
   * Example canonicalization order of top-level keys (sorted): `actor`, `eventId`, `eventType`, `hash` (excluded), `manifestSignatureId`, `meta`, `payload`, `prevHash`, `signature` (excluded), `signer_kid`, `ts`, `ok` (actual sorting is lexicographic — ensure your serializer sorts keys).
   * After canonicalization to bytes, compute SHA-256 digest (hex lowercase) and set as `hash` value in the event object.
3. **Signing**:

   * Sign the `hash` (hex string) using KMS/HSM or signing-proxy with `MessageType: 'DIGEST'` semantics whenever possible.
   * Include `signer_kid` indicating signer used.
   * Append `signature` in base64 or an ASCII-armored block; be explicit which form is used.

**Implementation tip**: Use a shared canonicalizer library (Node + Go parity test) to ensure parity. Provide test vectors and example canonical bytes for known events (e.g., see `kernel/test/node_canonical_parity.test.js`).

---

## 4 — Atomicity & persistence

**Atomic write pattern** (recommended):

1. Begin DB transaction.
2. Persist domain state change (e.g., allocation record, eval ingestion).
3. Prepare AuditEvent object (with `prevHash` from last persisted audit row).
4. Canonicalize and compute `hash`.
5. Obtain `signature` from KMS/signing-proxy (or call `kernel/sign` where appropriate), set `signature` + `signer_kid`.
6. Persist AuditEvent row in audit table with `hash`, `signature`, etc.
7. Commit DB transaction.

If signing requires external network call that cannot be in same DB transaction, use a write-ahead staging pattern:

* Write a pending audit record with status `pending_signature`, durable to DB.
* After obtaining `signature`, update the audit row, then mark `committed`.
* Ensure a recovery process (`audit-stager`) attempts to complete pending signatures and persists them; include monitoring/alerting for stuck pending records.

**Important**: Avoid cases where state changes commit but AuditEvent fails to persist. If unavoidable, operator must have robust replay tooling that can reconcile missed events and mark any reconciliation steps in the audit chain (with explicit events).

---

## 5 — Storage & archival

* **Primary store**: Postgres (or dedicated audit DB) for fast queries and indexing.

  * Table `audit_events` fields: `eventId`, `eventType`, `actor`, `ts`, `payload` (JSONB), `prevHash`, `hash`, `signer_kid`, `signature` (text), `manifestSignatureId` (nullable), `meta` (JSONB), `created_at`.
  * Indexes: `created_at`, `eventType`, `actor`, `hash`.
* **Archive**: Regular export of audit events to S3 (immutable archive):

  * Export format: gzipped JSONL of canonicalized events (one canonicalized JSON object per line).
  * Archive path format: `s3://illuvrse-audit-archive-${ENV}/audit-events/YYYY/MM/DD/<batch>.jsonl.gz`
  * Set Object Lock: COMPLIANCE and bucket versioning ON.
  * Retention policy: defined by compliance; example 7+ years for compliance, adjust per org policy.
* **Rotation & batching**:

  * Export batches hourly or daily. Include sequence metadata and starting/ending hashes for quick verification.
* **Permissions**:

  * Archive bucket must be write-limited to audit-writer role; delete restricted via Object Lock and IAM.

---

## 6 — Replay & verification

**Replay goal**: reproduce the audit chain, verify each event hash, verify signatures using published public keys, and validate `prevHash` chaining.

**Tools**:

* `kernel/tools/audit-verify.js` — canonical script in repo used to verify audit chains against DB or archive.
* `memory-layer/service/audit/verifyTool.ts` — module-specific audit verify tool.

**Basic verification steps (example)**:

1. Pull archive batch or read audit rows from DB in chronological order.
2. For each event:

   * Remove `signature` from object copy, canonicalize, compute SHA-256 hex → compare to the `hash` field on event.
   * Verify `prevHash` equals prior event’s `hash` for the chain.
   * Verify `signature` against `hash` using `signer_kid` public key (obtain public key from `kernel/tools/signers.json` or key registry).
3. Any mismatch indicates tampering or implementation bug.

**Command example**:

```bash
# verify DB range (example)
node kernel/tools/audit-verify.js -d "postgresql://user:pass@host:5432/auditdb" -s kernel/tools/signers.json --from 2025-11-01 --to 2025-11-02

# verify archive file
node kernel/tools/audit-verify.js -a s3://illuvrse-audit-archive-prod/audit-events/2025/11/20/batch-0001.jsonl.gz -s kernel/tools/signers.json
```

**Output**:

* A successful run prints `Audit chain verified` and exit `0`.
* On failure, report event id, position, which check failed (hash mismatch, prevHash mismatch, signature verification failure), and abort non-zero.

---

## 7 — Recovery & reconciliation

If the verification tool discovers missing or corrupt events:

* **Missing events**: Attempt to find pending audit staging rows or incomplete signature entries. Run stager to complete pending signatures. If permanently missing, write a signed reconciliation AuditEvent describing the gap, the rationale and recovery steps.
* **Corrupt events**: Investigate source of corruption — storage, export, serializer mismatch. Compare canonical bytes from multiple replicas or CI parity vectors.
* **Reconciliation event**: If an event was legitimately replaced via a known process (e.g., correction), emit a correction AuditEvent referencing the original eventId and clearly mark the correction. Correction must be append-only, never mutate old event.

---

## 8 — Event types & examples (recommended)

Example event types used by Eval Engine / Allocator:

* `eval.submit` — on eval ingestion. Payload includes `eval_id`, `source`, `metrics`.
* `promotion.request` — promotion submitted by Eval Engine. Payload includes `promotion_id`, `artifactId`, `score`, `evidence`.
* `policy.decision` — recorded by SentinelNet/consumers when policy evaluated (include `policy_id`, `decision`, `rationale`).
* `allocation.request` — allocation reservation created.
* `allocation.settlement` — settlement after ledger proof.
* `manifest.signed` — Kernel-signed manifest recorded by IDEA/RepoWriter consumers.
* `audit.reconciliation` — system emitted record describing reconciliation actions (explicit).

Each payload should have a compact, stable schema and be versioned in `meta` if shape changes over time.

---

## 9 — Testing & CI hooks

**Parity tests**:

* Add canonical parity test vectors: `test/vectors/audit_canonical_vectors.json` with sample events and their canonicalized bytes + expected `hash`. Run parity tests in CI across Node/Go implementations.

**CI checks**:

* `./scripts/ci/check-no-private-keys.sh` runs on PRs.
* `kernel/tools/audit-verify.js` should be runnable in CI against a small sample DB or sample archive produced in test to ensure event emission and signing are valid.

**Acceptance tests**:

* In staging, run `scripts/run_final_audit.sh` which calls `kernel/tools/audit-verify.js` and module-specific verify tools (that should return success).

---

## 10 — Operational runbooks & alerts

Provide runbooks for:

* `audit/signing-failure.md` — what to do if KMS signing fails (switch to signing-proxy fallback, alert Security on-call).
* `audit/replay-failure.md` — steps to investigate hash/signature mismatch.
* `audit/stager-monitoring.md` — monitor pending audit staging queue; alert at threshold.

**Alerts**:

* `audit_verify_failures_total > 0` — on verification failures in CI or nightly checks.
* `audit_stager_pending > 0` for > 10min — indicates pending signatures.
* `audit_archive_upload_failures_total` — alert high.

---

## 11 — Example: Minimal code sketch (pseudo)

```js
// PSEUDO: create and persist event atomically (DB tx)
async function emitAuditEvent(tx, eventType, actor, payload, manifestSigId = null) {
  const prev = await tx.query('SELECT hash FROM audit_events ORDER BY created_at DESC LIMIT 1');
  const prevHash = prev.rows[0]?.hash || null;

  let event = {
    ok: true,
    eventId: generateEventId(),
    eventType,
    actor,
    ts: new Date().toISOString(),
    payload,
    prevHash,
    manifestSignatureId: manifestSigId,
    meta: { module: 'eval-engine', env: process.env.ENV }
  };

  // canonicalize (exclude signature)
  const canonicalBytes = canonicalize(event); // sorted keys, UTF-8, no signature
  const hash = sha256Hex(canonicalBytes);
  event.hash = hash;

  // sign using KMS
  const signerKid = process.env.AUDIT_SIGNER_KID;
  const signature = await signDigestWithKms(hash);

  event.signature = signature;
  event.signer_kid = signerKid;

  // persist in same tx after state mutation has been added to tx
  await tx.query('INSERT INTO audit_events (...) VALUES (...)', [/*fields*/]);
}
```

---

## 12 — Final notes

* Keep canonicalizer and parity test vectors under repository test directory. Ensure parity tests run in CI.
* Ensure all modules that write audit events follow identical canonicalization/signing rules so `kernel/tools/audit-verify.js` can validate cross-module chains.
* For large scale, consider per-module chains or sharded chains; ensure global replay can stitch chains via a canonical ordering strategy (timestamps + per-module ordering + chain markers).

---

End of `eval-engine/audit-log-spec.md`.

---
