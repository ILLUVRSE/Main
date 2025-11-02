# Kernel — Audit Log Specification

## Purpose
The audit log is the immutable, verifiable record of every critical action in the Kernel. It must provide strong cryptographic guarantees (hash chain + signatures), be queryable for operations and compliance, and support verifiable exports for auditors and forensics.

---

## 1) High-level guarantees
- **Immutability:** Events are append-only. Once written they cannot be altered without detection.  
- **Integrity:** Each event includes a SHA-256 hash and is signed (Ed25519) so consumers can verify authenticity and integrity.  
- **Order & linkage:** Events are chained via `prevHash` so the full history is provably ordered.  
- **Availability:** Events are streamed for near-real-time inspection and durably stored for long-term retention.  
- **Accessibility:** Auditors and admins can query events, but only authorized roles can produce or modify events.

---

## 2) AuditEvent schema (canonical)
Fields (required unless noted):
- `id` — uuid: unique event identifier.  
- `eventType` — string: categorical name (e.g., `manifest.update`, `agent.spawn`, `allocation.request`, `sentinel.decision`).  
- `payload` — json: event-specific content (manifest, allocation, eval summary). Payload must be canonicalized before hashing.  
- `prevHash` — hex string | null: SHA-256 of the previous event in the chain (null for chain head).  
- `hash` — hex string: SHA-256 of canonical(payload) + prevHash (concatenated in that order).  
- `signature` — base64: Ed25519 signature over the `hash` (or canonical envelope containing hash + signer id + ts).  
- `signerId` — string: identifier for the key used to sign (maps to KMS/HSM key).  
- `ts` — timestamp: ISO8601 time when event was signed/created.  
- `metadata` — json (optional): indexing hints, origin service name, partition id, or references (manifestSignatureId, agentId).  
- `version` — string (optional): schema version for forwards compatibility.

**Notes:** The canonical `payload` must be consistent (see Canonicalization section). `hash` and `signature` must be computed exactly as specified to ensure verifiability.

---

## 3) Canonicalization & hashing rules
- Use a deterministic JSON canonicalization method (sorted object keys, consistent treatment of numbers/booleans/null, no extraneous whitespace, stable string escaping). Document which canonicalization algorithm is used (e.g., “Canonical JSON” or “JCS”) and reference it in this spec.  
- Compute `hash` as `SHA256( canonical(payload) || prevHash )`, where `||` denotes byte-concatenation and `prevHash` is the raw hex bytes (or an agreed binary form). If `prevHash` is null, use a predefined empty byte sequence.  
- Always include `version` in the envelope so future changes to schema are discoverable.

---

## 4) Signature rules
- Signatures use **Ed25519**. The signer signs the `hash` (or a small, canonical envelope containing `hash`, `signerId`, and `ts`) and the resulting signature is stored in `signature`.  
- `signerId` must be stable and resolvable to a public key available via Kernel’s security/status endpoints or the Key Registry.  
- Signature verification: verify the signature with the public key, then recompute `hash` and confirm it matches the stored `hash`.

---

## 5) Event creation flow (summary)
1. Service prepares `payload` for the event (manifest, allocation, etc.).  
2. Service requests canonicalization and hashing via Kernel helper or local library.  
3. Kernel (or authorized signing service) attaches `prevHash`, computes `hash`, requests signature from KMS/HSM, and receives `signature`.  
4. Kernel writes the completed AuditEvent to the append-only stream (Kafka topic `audit-events`) and a durable sink (Postgres index + S3 cold storage).  
5. Emit a short, signed pointer (event id + hash) to other consumers (SentinelNet, CommandPad).

**Important:** The signing step must be atomic with the append step to avoid gaps; implement a two-phase or transactional pattern where supported.

---

## 6) Storage and sinks
- **Primary stream:** Kafka/Redpanda topic `audit-events` with single-writer per partition to preserve order. Partitioning key based on time-range or logical shard (e.g., `partition = floor(ts / HOUR)` or `entity_id % N`).  
- **Durable sink:** Archive each event to S3 (immutable object store) with path `audit/YYYY/MM/DD/<id>.json`. Optionally compress and sign the S3 object.  
- **Query index:** Materialize a subset of fields (id, eventType, ts, signerId, hash, prevHash, metadata) into Postgres for fast queries and joins. Do not allow updates to these rows.  
- **Backup:** Periodic (daily) snapshots of S3 archive and Postgres indices; store snapshots in cold storage with retention policy.

---

## 7) Retention & archival
- **Hot retention:** Keep full index in Postgres for N90 days (configurable) for fast queries.  
- **Cold retention:** Keep full S3 archive for the policy period (e.g., 7 years) with immutable object locking where supported.  
- **Legal hold:** Allow marking events or buckets for extended retention beyond normal policy (auditor/legal operation).  
- **Deletion:** No deletion of audit events unless under an approved legal process; any deletion must itself be recorded as an audit event and marked in a separate tamper-evident ledger.

---

## 8) Verification & proof generation
- **Chain verification tool:** Provide a utility that:
  - Fetches events from S3/Postgres in order, recomputes each `hash` from `payload` and `prevHash`, verifies each `signature` against `signerId` public key, and reports mismatches.  
  - Produces a short summary proof (head hash and count) that auditors can verify.

- **Export for auditors:** Exports must include canonical payloads, hashes, signatures, and public key metadata. Include an index file with start/stop event ids and head hash. Provide signed proof of export.

- **Random spot-checks:** Periodic job verifies random samples and the full chain integrity nightly.

---

## 9) Access control & roles (audit events)
- **Producers:** Kernel core + authorized infra services (must use mTLS and be mapped to Producer role). Producers can write events to the primary stream.  
- **Consumers:** SentinelNet, CommandPad, Security tooling, and Auditors (read-only).  
- **Management:** Only SecurityEngineer / SuperAdmin may manage retention policies, legal holds, and run export proofs.

**Auditor privileges:** read-only access to historical events; no ability to produce or modify events.

---

## 10) Disaster recovery & replay
- Support replay from S3 to rebuild Postgres indices or to re-run verification after a suspected compromise. Replay must verify signatures and hashes before marking the rebuild successful.  
- Provide a safe-mode startup for the Kernel that rejects new signing requests while an integrity rebuild or key rotation is underway.

---

## 11) Performance & scaling notes
- Kafka partitions and retention tuning control throughput and hot query window. Use topic compaction only for metadata indexes; do not compact the main audit topic.  
- Use batching for S3 uploads and background workers for indexing to avoid write latency.  
- Ensure single-writer semantics per partition so `prevHash` ordering is consistent.

---

## 12) Handling key rotation & signer changes
- When rotating keys, include both old and new signer public keys in the Key Registry for a short overlap window. Old signatures remain verifiable using archived public keys.  
- Rotation events must themselves be audit events (signed by the previous key where possible) and recorded with the rotation metadata.

---

## 13) Example AuditEvent (minimal)
```json
{
  "id": "audit-0001",
  "eventType": "manifest.update",
  "payload": { "manifestId": "dvg-1a2b-3c4d", "version": "1.1.0", "changes": "budget+10000" },
  "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "hash": "e3b0c44298fc1c149afbf4c8996fb924... (hex SHA256)",
  "signature": "BASE64_SIG",
  "signerId": "kernel-signer-1",
  "ts": "2025-01-10T12:00:10Z",
  "metadata": { "origin": "kernel-api", "manifestSignatureId": "sig-01" }
}

14) Acceptance criteria (how we know it’s done)

AuditEvent schema implemented and agreed.

Canonicalization algorithm is defined and a reference implementation exists for verification.

Chain creation and verification process documented and tested on sample data.

Events are streamed to a durable sink (S3) and indexed for queries (Postgres).

A verification tool exists that validates the chain and signatures and produces a signed proof for auditors.

Retention and legal-hold processes documented and enforced.

End of spec.
