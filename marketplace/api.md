# Marketplace — API & Examples

This document defines the Marketplace HTTP API: catalog, SKU preview sandbox, checkout, license issuance, delivery, signed proofs, and payment/finance integration. All endpoints return JSON and follow the `{ ok: boolean, ... }` envelope. Production must enforce mTLS / server-side tokens for service-to-service calls and JWT/OIDC for human-facing flows. See `marketplace/acceptance-criteria.md` for testable gates. 

---

## Conventions

* **Base URL**: `https://marketplace.example.com` (adjust per deployment).
* **Envelope**: All successful responses have `{ "ok": true, ... }`. Errors use `{ "ok": false, "error": { "code": "...", "message": "...", "details": {...} } }`.
* **Auth**:

  * Human clients (Control-Panel / buyer UI) use `Authorization: Bearer <JWT>` (OIDC / session-backed).
  * Service-to-service calls (Kernel, Finance, ArtifactPublisher) should use mTLS or a server-side bearer token `Authorization: Bearer <SERVICE-TOKEN>`; prefer mTLS in production.
* **Idempotency**: Endpoints that create resources accept `Idempotency-Key` header. Server returns the original created resource if a duplicate key is submitted.
* **Audit**: Any state-changing call must emit an AuditEvent containing `actor_id`, `event_type`, `payload`, `hash`, `prev_hash`, `signature` (or reference to Kernel-signed manifest). See Audit section.
* **Manifest validation**: Marketplace must validate Kernel-signed manifests before listing or delivering a SKU; invalid manifests are rejected.

---

## Common types

### SKU manifest (example)

A SKU’s Kernel-signed manifest is provided by the author/Kernel and must be validated before listing/delivery.

```json
{
  "id": "sku-abc-123",
  "title": "My Model",
  "version": "1.0.0",
  "checksum": "sha256:abcdef...",
  "author": { "id": "actor:alice", "name": "Alice" },
  "license": { "type": "single-user", "terms": "..." },
  "artifacts": [
    { "artifact_id": "art-001", "artifact_url": "s3://...", "sha256": "..." }
  ],
  "metadata": { "size_bytes": 123456 },
  "manifest_signature": {
    "signer_kid": "kernel-signer-v1",
    "signature": "<base64>",
    "ts": "2025-11-17T12:34:56Z"
  }
}
```

### Signed proof (delivery proof)

Generated on settlement/delivery. Marketplace or ArtifactPublisher issues signed proof that ties artifact, manifest and finance ledger.

```json
{
  "proof_id": "proof-20251117-001",
  "order_id": "order-123",
  "artifact_sha256": "abcdef...",
  "manifest_signature_id": "manifest-sig-xyz",
  "ledger_proof_id": "ledger-proof-20251117-abc", 
  "signer_kid": "artifact-publisher-signer-v1",
  "signature": "<base64>",
  "ts": "2025-11-17T12:35:10Z"
}
```

### License document (example)

The license issued to the buyer is signed and contains ownership and limits.

```json
{
  "license_id": "lic-0001",
  "order_id": "order-123",
  "sku_id": "sku-abc-123",
  "buyer_id": "user:buyer@example.com",
  "scope": { "type": "single-user", "expires_at": "2026-11-16T23:59:59Z" },
  "issued_at": "2025-11-17T12:36:00Z",
  "signer_kid": "marketplace-signer-v1",
  "signature": "<base64>"
}
```

---

## Endpoints

### Health & metadata

#### `GET /health`

Returns health and transport summary (mTLS status, Kernel connectivity).

Response:

```json
{ "ok": true, "mTLS": true, "kernelConfigured": true, "signingConfigured": true }
```

#### `GET /ready`

Readiness: checks DB, Kernel probe, S3 probe.

---

### Catalog & SKU

#### `GET /catalog`

List SKUs. Supports pagination, filters.

Query params: `?page=1&page_size=20&query=&tags=&author=`

Response:

```json
{
  "ok": true,
  "items": [
    { "sku_id": "sku-abc-123", "title": "My Model", "summary": "...", "price": 19999, "currency": "USD", "manifest_valid": true }
  ],
  "page": 1,
  "page_size": 20,
  "total": 135
}
```

#### `GET /sku/{sku_id}`

Get SKU details including manifest metadata (do not return private keys or full signed manifest unless caller is authorized).

Auth: `Authorization: Bearer <JWT>` for buyer or operator.

Response:

```json
{
  "ok": true,
  "sku": {
    "sku_id": "sku-abc-123",
    "title": "My Model",
    "description": "...",
    "price": 19999,
    "currency": "USD",
    "manifest": { /* manifest metadata and signer id, but only disclose full manifest to authorized principals */ }
  }
}
```

#### `POST /sku` (admin)

Create or register a SKU (server-side / operator). Validates Kernel-signed manifest before accepting.

Headers: `Authorization: Bearer <operator-token>` (Kernel or Control-Panel), `Content-Type: application/json`.

Body:

```json
{
  "manifest": { /* Kernel-signed manifest object */ },
  "catalog_metadata": { "categories": ["ml-model"], "visibility": "public" }
}
```

Response:

```json
{ "ok": true, "sku_id": "sku-abc-123", "manifestSignatureId": "manifest-sig-xyz" }
```

Errors: `400` for invalid manifest, `403` unauthorized.

---

### Preview sandbox

#### `POST /sku/{sku_id}/preview`

Create a preview sandbox session. This starts an isolated sandbox instance linked to `sku_id`.

Auth: Buyer or demo user.

Body:

```json
{
  "sku_id": "sku-abc-123",
  "expires_in_seconds": 900,
  "session_metadata": { "requested_by": "user@example.com" }
}
```

Response:

```json
{
  "ok": true,
  "session_id": "preview-sess-987",
  "endpoint": "wss://sandbox.example.com/sessions/preview-sess-987",
  "expires_at": "2025-11-17T13:30:00Z"
}
```

Notes:

* Sandbox must enforce CPU/memory/timebox and network egress controls.
* Starting a preview emits an AuditEvent.

#### `GET /preview/{session_id}`

Get status and logs metadata for the preview session (admin/operator).

Response:

```json
{ "ok": true, "session_id": "preview-sess-987", "status": "running", "started_at":"...", "expires_at":"..." }
```

---

### Checkout & Orders

#### `POST /checkout`

Create a pending order and reserve the SKU.

Headers:

* `Authorization: Bearer <JWT>` (buyer)
* `Idempotency-Key: <key>` (required for safe retries)

Body:

```json
{
  "sku_id": "sku-abc-123",
  "buyer_id": "user:buyer@example.com",
  "payment_method": { "provider": "stripe", "payment_intent": "pi_..." },
  "billing_metadata": { "company": "Acme" },
  "delivery_preferences": {
    "mode": "buyer-managed",
    "buyer_public_key": "-----BEGIN PUBLIC KEY-----...",
    "key_identifier": "buyer-kms-key-01"
  },
  "order_metadata": { "correlation_id": "..." }
}
```

Response:

```json
{
  "ok": true,
  "order": {
    "order_id": "order-123",
    "sku_id": "sku-abc-123",
    "status": "pending",  // pending | paid | settled | failed
    "amount": 19999,
    "currency": "USD",
    "created_at": "2025-11-17T12:40:00Z",
    "delivery_mode": "buyer-managed"
  }
}
```

Behavior:

* Creates pending order and reserves SKU availability.
* Normalizes `delivery_preferences.mode`:
  * `buyer-managed` — caller supplies `buyer_public_key` (PEM). Marketplace encrypts the delivery key with the buyer key and records fingerprints in `key_metadata`.
  * `marketplace-managed` — Marketplace generates an ephemeral key using KMS/signing-proxy and stores wrapped ciphertext + signer metadata.
* Calls Payment Provider asynchronously or via webhook (see payment webhooks).
* Emits AuditEvent `order.created` with payload and links to manifest.

#### `POST /webhooks/payment` (public endpoint for payment provider)

* Validates provider signature (Stripe webhook signing) and updates order status.
* Forwards payment result to Finance via internal server-to-server call.

Response:

```json
{ "ok": true }
```

Security:

* Validate webhook signature, rate-limit, idempotency.

#### `GET /order/{order_id}`

Get order details and status.

Response:

```json
{ "ok": true, "order": { "order_id":"order-123", "status":"settled", "delivery": { "status": "ready", "proof_id": "proof-..." } } }
```

---

### Finalization, License issuance & Delivery

#### `POST /order/{order_id}/finalize`

Called when payment is cleared and Finance returns signed ledger proof. Marketplace finalizes the order: issues license, triggers ArtifactPublisher for signed proof & encrypted delivery.

Headers: `Authorization: Bearer <SERVICE-TOKEN>` (Marketplace server), `Idempotency-Key`.

Body:

```json
{
  "order_id": "order-123",
  "ledger_proof_id": "ledger-proof-20251117-abc",
  "ledger_proof_signature": "<base64>",
  "ledger_proof_signer_kid": "finance-signer-v1"
}
```

Response:

```json
{
  "ok": true,
  "order": {
    "order_id": "order-123",
    "status": "finalized",
    "license": {
      "license_id": "lic-0001",
      "signed_license": { /* license object + signature */ }
    },
    "delivery": {
      "delivery_id": "delivery-001",
      "status": "ready",
      "encrypted_delivery_url": "s3://encrypted/proof-abc",
      "proof_id": "proof-abc",
      "mode": "buyer-managed",
      "encryption": {
        "algorithm": "aes-256-gcm",
        "encrypted_key": "<base64>",
        "key_fingerprint": "sha256:abcd...",
        "key_hint": "buyer-kms-key-01"
      },
      "proof": {
        "proof_id": "proof-abc",
        "canonical_payload": { /* deterministic payload */ },
        "signer_kid": "artifact-publisher-signer-v1",
        "signature": "<base64>"
      }
    },
    "key_metadata": {
      "mode": "buyer-managed",
      "buyer_public_key_fingerprint": "sha256:abcd...",
      "created_at": "2025-11-17T12:45:00Z"
    }
  }
}
```

Behavior:

* Validate ledger proof signature and balanced ledger claim.
* Create license record and sign license with Marketplace signer (KMS or signing proxy) or delegate to ArtifactPublisher.
* Record AuditEvents for license issuance and delivery initiation.
* Persist `key_metadata` describing encryption artifacts (buyer-managed fingerprints or KMS signer references).

#### `GET /order/{order_id}/license`

Return signed license (for verified buyer or auditor with appropriate rights).

Response:

```json
{ "ok": true, "license": { "license_id":"lic-0001", "signed_license": {...} } }
```

---

### License verification

#### `POST /license/verify`

Verifies the license signature and ownership.

Request:

```json
{
  "license": { /* license JSON */ },
  "expected_buyer_id": "user:buyer@example.com"
}
```

Response:

```json
{
  "ok": true,
  "verified": true,
  "details": {
    "license_id": "lic-0001",
    "signer_kid": "marketplace-signer-v1",
    "ts": "2025-11-17T12:36:00Z"
  }
}
```

If verification fails:

```json
{ "ok": false, "error": { "code": "LICENSE_INVALID", "message": "Signature verification failed" } }
```

---

### Signed proofs & ArtifactPublisher

Marketplace will either generate signed proofs (if it owns the ArtifactPublisher responsibilities) or call ArtifactPublisher.

#### `GET /proofs/{proof_id}`

Return proof details and signature (used to validate delivery).

Response:

```json
{
  "ok": true,
  "proof": {
    "proof_id": "proof-20251117-001",
    "order_id": "order-123",
    "artifact_sha256": "abcdef...",
    "delivery_mode": "buyer-managed",
    "canonical_payload": { "proof_id": "proof-20251117-001", "order_id": "order-123", "ledger_proof_id": "ledger-proof-xyz" },
    "signature": "<base64>",
    "signer_kid": "artifact-publisher-signer-v1",
    "ts": "2025-11-17T12:35:10Z",
    "key_metadata": {
      "mode": "buyer-managed",
      "buyer_public_key_fingerprint": "sha256:abcd..."
    }
  }
}
```

---

### Admin: manifest validation & signer registry

#### `POST /admin/validate-manifest`

Validate a Kernel-signed manifest (used in PRs & CI).

Request:

```json
{ "manifest": { /* kernel manifest */ } }
```

Response:

```json
{ "ok": true, "valid": true, "manifestSignatureId": "manifest-sig-xyz" }
```

Errors: `INVALID_SIGNATURE`, `MANIFEST_MISMATCH`.

---

## Error codes (examples)

* `INVALID_MANIFEST` — manifest fails Kernel signature or checksum verification.
* `INSUFFICIENT_FUNDS` — payment declined by provider.
* `LEDGER_PROOF_INVALID` — finance proof missing or signature invalid.
* `LICENSE_INVALID` — license signature invalid.
* `NOT_AUTHORIZED` — insufficient role/capability.
* `INSUFFICIENT_APPROVALS` — admin apply blocked on approvals (for multisig flows).
* `RATE_LIMITED` — request rate exceeded.

---

## Audit events

Every state-changing operation MUST emit an AuditEvent, either directly or via Kernel when integrated. Each AuditEvent should contain:

```json
{
  "actor_id": "user:alice@example.com",
  "event_type": "order.created",
  "payload": { /* canonicalized payload */ },
  "hash": "<sha256 hex>",
  "prev_hash": "<hex or empty>",
  "signature": "<base64>",
  "signer_kid": "marketplace-signer-v1",
  "created_at": "2025-11-17T12:40:00Z"
}
```

* The `hash` is `sha256(canonical(payload) || prevHashBytes)` per Kernel conventions. Use Kernel canonicalization helper to produce canonical payloads.
* If Marketplace delegates signing to Kernel or ArtifactPublisher, record `manifest_signature_id` or `manifestSignatureId` linking to Kernel-signed manifest.

Audit events are used in acceptance tests and are exported to S3 with object-lock for compliance.

---

## Example flows

### 1) Buyer checkout (summary)

1. `POST /checkout` with `Idempotency-Key`. Marketplace creates order (`pending`) and emits `order.created` AuditEvent.
2. Marketplace initiates payment (third-party). Payment returns webhook to `/webhooks/payment`.
3. On successful payment, Marketplace calls Finance with settlement details; Finance returns a signed ledger proof.
4. Marketplace calls `POST /order/{id}/finalize` with ledger proof. Marketplace validates proof, issues a license, triggers ArtifactPublisher for encrypted delivery, and emits `order.finalized` AuditEvent.
5. Buyer requests `GET /order/{id}/license` — Marketplace returns signed license.

### 2) Preview sandbox

1. `POST /sku/{id}/preview` → Marketplace starts sandbox, emits `preview.started` AuditEvent.
2. Sandbox runs enforce timebox and returns logs. On expiration, Marketplace emits `preview.expired` event.

---

## Security & compliance notes (must be enforced)

* **No private keys in repo** — KMS / signing proxy must be used in production; `REQUIRE_KMS=true` or `REQUIRE_SIGNING_PROXY=true` enforced in CI/production. See Kernel docs & KMS IAM policy. 
* **PCI compliance** — do not store raw card data. Use third-party payment provider (Stripe). Webhooks must be validated. See `marketplace/docs/prd-security.md`.
* **Idempotency and replay** — ensure `Idempotency-Key` semantics for checkout/finalize and webhook handlers.
* **Encrypted delivery** — use buyer keys (short-lived) or HSM-managed ephemeral keys; record key provenance in delivery AuditEvent.

---

## Testing & CI

* **Contract tests**: ensure request/response shapes match `api.md`. Run as part of CI.
* **Integration/e2e tests**: deterministic checkout → payment → finance → proof → license → delivery. Local harness `run-local.sh` should start mocks for Kernel, Finance, Payment Provider, ArtifactPublisher.
* **Audit verification**: run `kernel/tools/audit-verify.js` against exported audit rows for verification.

---
