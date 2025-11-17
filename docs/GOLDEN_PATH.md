# GOLDEN_PATH — publish & buy (IDEA → Kernel → ArtifactPublisher → Marketplace → Finance)

> Purpose — one sentence
> The Golden Path is the single canonical, auditable flow that proves the core product: a creator builds an artifact, Kernel signs it, the artifact is published/paid-for, Finance records the ledger entry, and the buyer receives an encrypted delivery + verifiable signed proof.

This document specifies the minimal steps, exact endpoints, request/response examples, required AuditEvent shapes, verification steps, and acceptance criteria.

Sources / contracts referenced:

* IDEA Creator API (artifact contract & kernel sign request/response). 
* Kernel API (`POST /kernel/sign`) and audit log spec.  
* ArtifactPublisher endpoints (`/api/checkout`, `/api/proof`, multisig).  
* Marketplace API spec for SKU, checkout, deliver. 
* Finance API (journal posting, proofs, multisig payouts). 

---

## Actors & components (brief)

* **Creator (IDEA)** — packages an artifact (agent bundle), computes `sha256`, uploads to storage (S3/MinIO), and requests Kernel to sign the artifact manifest. IDEA has the Creator API contract. 
* **Kernel** — signs manifests, enforces RBAC, emits AuditEvents (hash + signature + prevHash), and runs multisig for high-risk operations.  
* **ArtifactPublisher** — accepts the Kernel-signed manifest, handles checkout/proof/license/delivery flows, and records audit events & proofs. Routes: `/api/checkout`, `/api/proof`, `/api/multisig`. 
* **Marketplace** — registers SKU referencing Kernel-signed manifest, validates signatures, provides preview sandboxes, handles user checkout and invokes Finance/ArtifactPublisher for settlement and delivery. 
* **Finance** — double-entry ledger, receipt of journal entries, multisig payout approvals, signed proofs retrieval. 

---

## High-level sequence (one-line)

IDEA packages & uploads artifact → IDEA calls `POST /kernel/sign` → Kernel signs & emits `AuditEvent` → ArtifactPublisher / RepoWriter consumes the signed manifest → Marketplace registers SKU (verifies signature) → Buyer checkout → Marketplace calls Finance (`POST /finance/journal`) → ArtifactPublisher generates encrypted delivery + signed proof → Verify audit chain, signatures, and ledger proof.

---

## Step-by-step with exact API calls and examples

### 0) Prerequisites

* Storage (S3/MinIO) available to receive the artifact.
* Kernel endpoint and credentials (OIDC or mTLS for services). Kernel exposes `POST /kernel/sign`. 
* ArtifactPublisher service reachable and configured with `KERNEL_URL`. 
* Finance service reachable (mTLS + auth). 

---

### 1 — IDEA: package artifact, compute sha256, upload to storage

**Action:** Creator packages an `agent_bundle` and computes a SHA-256 checksum.

**Artifact (example)** — `agent_bundle` (key fields):

```json
{
  "artifact_id": "d1c82640-a2e6-4a50-b304-e7dfa05e2ae8",
  "artifact_url": "s3://illuvrse-dev/artifacts/d1c82640.model",
  "sha256": "e3b0c44298fc1c149afbf4c8996fb924... (64 hex chars)",
  "agent_config": { /* agent_config per schema */ },
  "created_by": "alice@example.com",
  "created_at": "2025-11-06T12:00:00Z",
  "size_bytes": 1234567
}
```

(IDEA schemas: see `agent_bundle` + `agent_config` in IDEA spec.) 

**Note:** Use deterministic canonicalization for any payload that will be hashed and signed.

---

### 2 — IDEA → Kernel: request a signed manifest

**Endpoint:** `POST /kernel/sign` (Kernel API)
**Purpose:** Get a Kernel-signed manifest or `accepted` + callback flow.

**Request (kernel_sign_request shape)**:

```http
POST /kernel/sign
Content-Type: application/json
Authorization: Bearer <IDEA_service_token>

{
  "artifact_url": "s3://illuvrse-dev/artifacts/d1c82640.model",
  "sha256": "e3b0c44298fc1c149afbf4c8996fb924...",
  "actor_id": "alice@example.com",
  "metadata": { "workspace": "my-ws", "profile": "illuvrse" },
  "callback_url": "https://idea.example.com/kernel/callback",   # optional
  "profile": "illuvrse"
}
```

(Contract based on IDEA's `kernel_sign_request`.) 

**Synchronous successful response (Kernel returns signed manifest):**

```json
{
  "manifest": {
    "agent_id": "agent-uuid",
    "artifact_url": "s3://.../d1c82640.model",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb924...",
    "metadata": { "owner": "alice@example.com", "version": "0.1.0" },
    "kernel_version": "v1.0.0"
  },
  "signature": "BASE64_ED25519_SIGNATURE",
  "signer_kid": "kernel-signer-1",
  "signed_at": "2025-11-06T12:05:01Z",
  "validation_url": "https://kernel.example.com/kernel/sign/validation/1234"  # optional
}
```

(Format per IDEA’s `kernel_signed_manifest`). 

**Alternate async flow:** Kernel may return `{ ok: true, accepted: true, callback_url: ... }` and later POST to `callback_url` the signed manifest. IDEA must validate `X-Kernel-Signature` and replay protection headers per IDEA docs. 

**Kernel obligations:**

* Verify requester RBAC (OIDC or mTLS). Kernel signs using Ed25519 via KMS/HSM or signing proxy. Kernel emits a canonical `AuditEvent` for the manifest sign action. 

---

### 3 — Kernel: Emit AuditEvent for the signed manifest

**Why:** AuditEvent is the canonical, append-only proof that a manifest was signed; it ties hash → signature → prevHash.

**AuditEvent (minimal example)** — per `kernel/audit-log-spec.md`:

```json
{
  "id": "audit-0001",
  "eventType": "manifest.signed",
  "payload": {
    "manifestId": "manifest-uuid",
    "artifact_url": "s3://.../d1c82640.model",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb924...",
    "signer_kid": "kernel-signer-1",
    "signed_at": "2025-11-06T12:05:01Z",
    "actor_id": "alice@example.com",
    "manifest": { /* canonical manifest object as signed */ }
  },
  "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "hash": "e3b0c44298fc1c149afbf4c8996fb924...(hex SHA256 of canonical(payload) || prevHash)",
  "signature": "BASE64_ED25519_SIGNATURE",
  "signerId": "kernel-signer-1",
  "ts": "2025-11-06T12:05:01Z",
  "metadata": { "origin": "kernel-api", "manifestSignatureId": "sig-01" }
}
```

Rules:

* Payload must be canonicalized deterministically (keys sorted, etc.). Kernel computes `hash = SHA256(canonical(payload) || prevHash)` and signs per the spec. `prevHash` is the previous event hash or a predefined empty sequence for the chain head. Consumers verify signature and recompute hash. 

**Where it’s stored:** Kernel appends this to the audit stream (primary Kafka topic + Postgres index + S3 archive) so other services (SentinelNet, Control-Panel, ArtifactPublisher) can observe and reference it. 

---

### 4 — ArtifactPublisher / RepoWriter: ingest signed manifest

**Action:** The publisher consumes the signed manifest (either from IDEA push or a manifest registry) and prepares to create a SKU or commit repo metadata.

**Acceptance check (publisher):**

* Verify the Kernel signature on the manifest (signature + `signer_kid` resolves to Kernel public key).
* Verify `sha256` matches the uploaded artifact in storage (download or head request).
* Record a local audit pointer (Order/Artifact row referencing kernel audit event id + manifest signature id) and/or emit a local AuditEvent linking back to Kernel’s manifest.signed event.

**If RepoWriter:** Respect `repowriter_allowlist.json` when committing repo changes. RepoWriter is a dev tool and a compatibility shim — ArtifactPublisher is canonical for production delivery flows.  

---

### 5 — Marketplace: register SKU referencing Kernel-signed manifest

**Endpoint:** `POST /marketplace/sku` (see marketplace spec)
**Action:** Marketplace stores the SKU and validates the Kernel signature.

**Minimal request:**

```json
POST /marketplace/sku
Content-Type: application/json
Authorization: Bearer <marketplace-service-token>

{
  "skuId": "sku-0001",
  "title": "My Agent",
  "manifest": {
    "artifact_url": "s3://.../d1c82640.model",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb924...",
    "signature": "BASE64_SIG",
    "signer_kid": "kernel-signer-1",
    "signed_at": "2025-11-06T12:05:01Z"
  },
  "price": { "amount": "10.00", "currency": "USD" },
  "previewOptions": { "ttl_seconds": 600 }
}
```

(Per `marketplace/marketplace-spec.md`: SKU registration requires Kernel-signed manifest.) 

**Marketplace must:**

* Verify the manifest signature and `sha256` against storage.
* Emit an AuditEvent for `marketplace.sku.register` that references the kernel audit event id from the `manifest.signed` event.

---

### 6 — Buyer checkout (Marketplace → ArtifactPublisher → Finance)

**Endpoint (Marketplace):** `POST /marketplace/checkout` (or `/api/checkout` via ArtifactPublisher if doing turnkey checkout). 

**Example checkout POST** (ArtifactPublisher’s `/api/checkout` expects customer info and items; see `artifact-publisher/server/src/routes/checkout.ts`):

```http
POST /api/checkout
Content-Type: application/json

{
  "customerId": "cust-123",
  "email": "bob@example.com",
  "currency": "usd",
  "items": [
    { "sku": "sku-0001", "quantity": 1 }
  ]
}
```

(ArtifactPublisher normalizes and passes to `CheckoutService.processCheckout`.) 

**Checkout flow:**

1. Marketplace/ArtifactPublisher creates an `order` and charges the payment provider (Stripe or mock). ArtifactPublisher may use a `StripeMock` in dev. 
2. On payment success, Marketplace/ArtifactPublisher calls Finance to post a signed double-entry journal entry (`POST /finance/journal`). See Finance API. 

**Finance `POST /finance/journal` example:**

```http
POST /finance/journal
Authorization: Bearer <service-token>
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "entries": [
    {
      "journalId": "jrn-001",
      "batchId": "batch-001",
      "timestamp": "2025-11-06T12:10:00Z",
      "currency": "USD",
      "lines": [
        { "accountId": "cash", "direction": "debit", "amount": "10.00" },
        { "accountId": "revenue", "direction": "credit", "amount": "10.00" }
      ],
      "metadata": { "source": "marketplace", "orderId": "order-123" }
    }
  ]
}
```

(Finance returns `201 Created` with committed journal IDs when balanced.) 

**Finance obligations:**

* Post signed proofs (`GET /finance/proof`) for auditor export. Ledger slices include canonical hash chains and detached signature bundles. 

**ArtifactPublisher / Marketplace must:**

* Record the finance journal ID(s) as part of order metadata and emit an `order.completed` AuditEvent referencing both the Kernel manifest signature and Finance journal id.

---

### 7 — Delivery: ArtifactPublisher produces encrypted delivery + signed proof

**ArtifactPublisher responsibilities (routes / services)**:

* After payment confirmation, ArtifactPublisher builds an encrypted delivery package (derive short-lived encryption keys or use HSM-managed ephemeral keys), issues a signed proof of delivery, and writes a `delivery` record. It exposes `/api/proof/verify` to let consumers verify the delivery proof.  

**Proof verification:**

* Use `POST /api/proof/verify` with `{ proof, payload }` to verify the proof; response `{ valid: true }` indicates the delivery proof matches the payload and the kernel/ArtifactPublisher signatures validate. See `createProofRouter`. 

**Delivery audit event:** `delivery.generated` should include:

```json
{
  "manifestSignatureId": "sig-01",
  "orderId": "order-123",
  "deliveryId": "delivery-001",
  "delivery_url": "https://.../delivery/encrypted-blob",
  "proof": { /* proof record packaged and signed by proofService */ }
}
```

ArtifactPublisher must append an AuditEvent referencing the Kernel manifest event and the Finance journal entry.

---

## Verification checklist (how to prove the golden path worked)

1. **Manifest signature verification**

   * Fetch the Kernel-signed manifest returned by `POST /kernel/sign`. Verify `signature` using Kernel public key (`signer_kid`). Confirm `sha256` is the canonical hex of the artifact content (download or HEAD). (Spec: IDEA `kernel_signed_manifest`.) 

2. **Audit chain verification**

   * Fetch the Kernel `AuditEvent` for `manifest.signed` (via `GET /kernel/audit/{id}` or via archive). Recompute `hash` from canonical `payload` and `prevHash`, verify `signature` using `signerId`, and confirm chain ordering. Use the Kernel chain verification tool per `audit-log-spec.md`. 

3. **Finance ledger verification**

   * Confirm `POST /finance/journal` responded `201` and the returned IDs are present in `GET /finance/proof?from=...&to=...`. Download the proof package and verify included detached signatures. 

4. **Delivery proof verification**

   * Call `POST /api/proof/verify` on ArtifactPublisher with the `proof` and `payload`. Expect `{ valid: true }`. Alternatively verify the proof artifact offline using the ProofService logic. 

5. **End-to-end check**

   * Confirm the order record includes: SKU, kernel manifest signature id, Finance journal id, delivery id, and audit event ids. Re-run audit chain verification across Kernel → Marketplace → Finance → ArtifactPublisher entries.

---

## Failure modes & recovery (short)

* **Kernel signing fails / KMS not configured**: Kernel must refuse production mode without signing availability (`REQUIRE_KMS=true`). For dev, a mock signer is allowed; for prod, fatal startup. (Memory & AI-Infra already document these guards.) 
* **Manifest signature invalid / sha mismatch**: Marketplace or ArtifactPublisher must reject SKU registration or checkout. Return 403 / error and require re-upload + sign.
* **Finance posting fails (unbalanced entries)**: Finance returns `400`; the checkout must roll back or mark order as `settlement_failed` and record an AuditEvent for investigation. Finance supports idempotency and retries via `Idempotency-Key`. 
* **Delivery proof verification fails**: Revoke delivery, re-run proof generation, and emit audit event for `delivery.regenerate`. ArtifactPublisher should store proof generation logs and deterministic inputs for reproducible regeneration. 

---

## Acceptance criteria (for Golden Path)

* [ ] IDEA builds and uploads an artifact and obtains a Kernel-signed manifest (sync or callback). Verified by OK response and signature fields. 
* [ ] Kernel emits an `AuditEvent` of type `manifest.signed` and the chain verifies (hash/signature/prevHash). 
* [ ] ArtifactPublisher / Marketplace accepts the manifest only after verifying signature and artifact sha256. 
* [ ] Checkout succeeds: payment processed (or mocked in dev), `POST /finance/journal` returns `201`, and finance proof can be retrieved. 
* [ ] ArtifactPublisher produces an encrypted delivery and a delivery proof; `POST /api/proof/verify` returns `{ valid: true }`. 
* [ ] The end-to-end audit trace is present and verifiable: Kernel manifest `manifest.signed` event → Marketplace `sku.register` event → Finance `journal` audit → ArtifactPublisher `delivery` event. 

---

## Local dev debug commands (quick)

* Start IDEA local dev server: see `IDEA/server/README.md` (default `http://127.0.0.1:5175`). 
* Start ArtifactPublisher locally: `cd artifact-publisher/server && npm install && npm run build && npm start` (or `run-local.sh` which boots kernel mock + Postgres). `createApplication` wires `KernelClient` and `ProofService`.  
* Start Kernel mock used by ArtifactPublisher’s local tests: `artifact-publisher/server/mock/kernelMockServer.js`. Use it for e2e demo runs. 

---

## Implementation notes & tips (practical)

* **Canonicalization**: Always canonicalize JSON payloads before hashing/signing. Kernel’s audit spec mandates a deterministic canonicalization algorithm (sorted keys, stable number/boolean formatting). Use the same implementation across services. 
* **Idempotency**: Use `Idempotency-Key` for `POST /finance/journal` and other mutation endpoints. Finance enforces idempotency keys for safe retries. 
* **Signatures & signer ids**: Kernel’s `signer_kid` must be resolvable to a public key. Keep a Key Registry for signer ids. Key rotations must be audit-logged. 
* **Multisig**: For high-risk updates (policy activation, large payouts), use Kernel’s multisig flow (3-of-5); ArtifactPublisher and Finance include multisig endpoints/runbooks.  

---

## Appendix — quick reference snippets

**IDEA kernel_sign_request (schema excerpt)**: 

**IDEA kernel_signed_manifest (response excerpt)**: 

**Kernel AuditEvent canonical example**: 

**ArtifactPublisher routes used**: `/api/checkout`, `/api/proof/verify`, `/api/multisig` (see `artifact-publisher/src/app.ts`). 

**Marketplace endpoints used**: `POST /marketplace/sku`, `POST /marketplace/checkout`, `POST /marketplace/deliver`. 

**Finance journal API**: `POST /finance/journal` with double-entry `entries[]`. 

---

## Final notes

* The Golden Path is intentionally minimal: it forces the team to make signing, audit, finance, and delivery correct and testable before expanding other features.
* Once the Golden Path is green in CI, you can enable more complex flows (AI-Infra promotions, Agent Manager runtime, Eval Engine integration) while relying on the proven trust & ledger foundation.

---
