Paste this file as `finance/api.md`.

---

# Finance — API & Examples

This document defines the Finance HTTP API: ledger posting (double-entry), invoices, settlements, proof generation, reconciliation, and auditor exports. All endpoints return JSON and follow the `{ ok: boolean, ... }` envelope. Production requires mTLS or server tokens for service-to-service calls, strict RBAC for operator endpoints, and KMS/HSM-backed signing for proofs. See `finance/acceptance-criteria.md` for testable gates. 

---

## Conventions

* **Base URL**: `https://finance.example.com` (adjust per deployment).
* **Envelope**: Success: `{ "ok": true, ... }`. Error: `{ "ok": false, "error": { "code", "message", "details" } }`.
* **Auth**:

  * Service → service: mTLS or `Authorization: Bearer <SERVICE_TOKEN>`.
  * Human/operator: OIDC/JWT with 2FA enforced by IdP.
* **Idempotency**: All write endpoints accept `Idempotency-Key` header. Server must deduplicate by idempotency key.
* **Audit**: Every state-changing operation must emit an AuditEvent with `hash`, `prev_hash`, and `signature` (or reference to a Kernel-signed manifest/ledger proof).
* **Signing**: Signed proofs must come from KMS/HSM or signing proxy and include `signer_kid` + `signature` + `ts`.

---

## Common types

### Journal entry (atomic transaction)

A single logical posting contains multiple journal lines (double-entry).

```json
{
  "journal_id": "jrn-20251117-0001",
  "entries": [
    { "account_id": "asset:escrow:order-123", "side": "debit",  "amount_cents": 19999, "currency": "USD", "meta": {} },
    { "account_id": "revenue:sku-abc",          "side": "credit", "amount_cents": 19999, "currency": "USD", "meta": {} }
  ],
  "context": { "source": "marketplace", "order_id": "order-123" },
  "ts": "2025-11-17T12:00:00Z"
}
```

### Ledger proof

A cryptographic proof for a ledger range.

```json
{
  "proof_id": "ledger-proof-20251117-001",
  "range": { "from_ts": "2025-11-01T00:00:00Z", "to_ts": "2025-11-30T23:59:59Z" },
  "hash": "<sha256 hex>",
  "signer_kid": "finance-signer-v1",
  "signature": "<base64>",
  "ts": "2025-11-30T23:59:59Z"
}
```

---

## Endpoints

### Health & readiness

#### `GET /health`

Returns health status and whether signing/KMS is configured.

Response:

```json
{ "ok": true, "mTLS": true, "signingConfigured": true }
```

#### `GET /ready`

Checks DB connectivity, KMS/signing proxy availability, and audit exporter readiness.

---

### Ledger & journal

#### `POST /ledger/post`

**Purpose:** atomically post a journal (double-entry). The request must contain a set of entries that balance.

Headers:

* `Authorization: Bearer <SERVICE_TOKEN>` (service) or operator JWT.
* `Idempotency-Key: <key>` (strongly recommended)

Body:

```json
{
  "journal_id": "jrn-20251117-0001",
  "entries": [
    { "account_id": "asset:escrow:order-123", "side": "debit",  "amount_cents": 19999, "currency": "USD", "meta": {} },
    { "account_id": "revenue:sku-abc",          "side": "credit", "amount_cents": 19999, "currency": "USD", "meta": {} }
  ],
  "context": { "source": "marketplace", "order_id": "order-123" }
}
```

Success response:

```json
{ "ok": true, "journal_id": "jrn-20251117-0001", "posted_at": "2025-11-17T12:01:00Z" }
```

Errors:

* `LEDGER_IMBALANCE` — debits != credits (400)
* `IDEMPOTENCY_CONFLICT` — idempotency key used with different payload (409)
* `NOT_AUTHORIZED` (401/403)

**Behavior**: Post is atomic; if signing or ledger persistence fails, the whole operation must roll back.

---

#### `GET /ledger/{journal_id}`

Get details of a posted journal and its audit metadata.

Response:

```json
{ "ok": true, "journal": { /* posted journal fields */ }, "audit": { "hash": "...", "signature": "...", "signer_kid": "finance-signer-v1" } }
```

---

### Invoices & settlement

#### `POST /invoices`

Create an invoice record for external billing or settlement.

Body:

```json
{
  "invoice_id": "inv-20251117-001",
  "journal_ref": "jrn-20251117-0001",
  "amount_cents": 19999,
  "currency": "USD",
  "payer": { "id": "buyer:1", "name": "Acme" },
  "due_date": "2025-12-17"
}
```

Response:

```json
{ "ok": true, "invoice_id": "inv-20251117-001" }
```

---

#### `POST /settlement`

Called by payment or marketplace to confirm payment and request ledger posting and proof creation.

Body:

```json
{
  "settlement_id": "sett-abc-123",
  "invoice_id": "inv-20251117-001",
  "payment": { "provider": "stripe", "reference": "pi_...", "amount_cents": 19999, "currency": "USD" },
  "context": { "order_id": "order-123" }
}
```

Response:

```json
{ "ok": true, "settlement_id": "sett-abc-123", "status": "posted", "journal_id": "jrn-20251117-0001" }
```

Behavior:

* Creates balanced journal entries for settlement atomically and emits AuditEvent(s).
* If Finance must interact with external payout providers, those flows are orchestrated and audited.

---

### Proof generation & retrieval

#### `POST /proofs/generate`

Generate a signed proof for a ledger range (ad-hoc, scheduled, or for a specific invoice/journal).

Body:

```json
{
  "request_id": "req-001",
  "range": { "from_ts": "2025-11-01T00:00:00Z", "to_ts": "2025-11-30T23:59:59Z" },
  "caller": { "service": "marketplace", "requester": "service:marketplace" }
}
```

Response:

```json
{ "ok": true, "proof_id": "ledger-proof-20251130-001", "status": "generating" }
```

Proof generation is asynchronous for large ranges. The service will sign the canonicalized digest via KMS/signing-proxy and persist proof metadata plus the signature.

#### `GET /proofs/{proof_id}`

Return proof JSON and signature.

```json
{
  "ok": true,
  "proof": {
    "proof_id": "ledger-proof-20251130-001",
    "range": {...},
    "hash": "...",
    "signer_kid": "...",
    "signature": "...",
    "ts": "..."
  }
}
```

**Verification helper**: See `finance/tools/verify_proof.js` (recommended) to validate proofs using a public key.

---

### Reconciliation

#### `POST /reconcile`

Start a reconciliation job comparing external payment provider records to ledger entries.

Body:

```json
{
  "request_id": "rec-20251117-001",
  "from_ts": "2025-11-01T00:00:00Z",
  "to_ts": "2025-11-30T23:59:59Z",
  "provider": "stripe"
}
```

Response:

```json
{ "ok": true, "reconcile_id": "reconcile-20251117-001", "status": "running" }
```

#### `GET /reconcile/{id}`

Fetch reconciliation report and discrepancies.

Response:

```json
{
  "ok": true,
  "reconcile_id": "...",
  "status": "completed",
  "discrepancies": [
    {
      "order_id": "order-200",
      "ledger_amount": 19999,
      "provider_amount": 0,
      "reason": "provider_missing"
    }
  ]
}
```

---

### Auditor export

#### `POST /exports/audit`

Trigger export of audit batches to S3 with Object Lock metadata.

Body:

```json
{
  "request_id": "export-20251117-001",
  "from_ts": "2025-11-01T00:00:00Z",
  "to_ts": "2025-11-30T23:59:59Z",
  "pii_included": false
}
```

Response:

```json
{ "ok": true, "export_id": "export-20251117-001", "s3_path": "s3://illuvrse-audit-archive/prod/2025-11-17/export-20251117-001.jsonl.gz" }
```

**Export metadata** must include `service`, `env`, `pii_included`, `pii_policy_version`, and `ts`. Use `finance/infra/audit_export_policy.md` to configure S3 lifecycles & Object Lock.

---

### Admin & operator endpoints

#### `GET /health/proofs` (operator)

Summary of pending proofs, last-proof ts, error counts.

#### `POST /admin/resend-journal` (operator, audited)

Resend or re-post a journal (requires reason & signoff). Emits AuditEvent and must be scoped to an operator role.

---

## Error codes (examples)

* `LEDGER_IMBALANCE` — Debits != Credits (400)
* `IDEMPOTENCY_CONFLICT` — Different payload with same Idempotency-Key (409)
* `PROOF_NOT_FOUND` — The requested proof id not found (404)
* `SIGNING_FAILURE` — KMS/signing-proxy could not sign (500)
* `NOT_AUTHORIZED` — Insufficient permissions (401/403)
* `RECONCILE_ERROR` — Provider report parsing failed (500)
* `AUDIT_EXPORT_ERROR` — Export job failed (500)

Ensure clients handle these with retries and alerting.

---

## Audit events

Every state-changing operation (journal post, invoice create, settlement, proof generation, reconciliation, export) must emit an AuditEvent with canonicalized payload and signing metadata:

```json
{
  "actor_id": "service:marketplace",
  "event_type": "ledger.post",
  "payload": { /* canonicalized journal object */ },
  "hash": "<sha256 hex>",
  "prev_hash": "<hex or null>",
  "signature": "<base64>",
  "signer_kid": "finance-signer-v1",
  "created_at": "2025-11-17T12:01:00Z"
}
```

Audit chain must be verifiable via `kernel/tools/audit-verify.js` or Finance-provided verifier. See `finance/acceptance-criteria.md` for audit gating. 

---

## Example flows

### A. Settlement flow (summary)

1. Marketplace calls `POST /settlement` with payment result.
2. Finance validates settlement context and posts a balanced journal via internal posting logic (`POST /ledger/post`).
3. Upon successful post, Finance emits AuditEvent(s) for ledger rows.
4. Finance schedules proof generation or responds synchronously with a proof for small ranges.
5. Marketplace receives proof and proceeds to finalize delivery.

### B. Proof generation & verification

1. Operator or automated job calls `POST /proofs/generate` for a range.
2. Finance canonicalizes the range, computes digest, and signs via KMS/signing-proxy.
3. Proof stored with `signer_kid` and signature. `GET /proofs/{proof_id}` returns signed proof.
4. Auditors verify signature using public key published in Kernel verifier registry.

---

## Security & operational notes

* **KMS/Signing**: Use KMS or signing-proxy only. For RSA digest signing use `MessageType: 'DIGEST'`. See `agent-manager/signAuditHash` and Kernel examples. 
* **Idempotency**: Clients must provide `Idempotency-Key` for all write flows; Finance must deduplicate.
* **No private keys in repo**: CI must guard against PEM/private key commits. Run the repo scan job in CI.
* **RBAC**: Restrict admin endpoints. Operator actions must record signer identity in AuditEvent.

---

## Minimal test & verification commands

```bash
# Post a balanced journal (local)
curl -X POST https://finance.local/ledger/post \
  -H "Authorization: Bearer $FINANCE_TOKEN" \
  -H "Idempotency-Key: test-123" \
  -H "Content-Type: application/json" \
  -d @test/fixtures/journal-balanced.json

# Generate a proof (sync or async)
curl -X POST https://finance.local/proofs/generate -H "Authorization: Bearer $FINANCE_ADMIN" -d '{"range": {...}}'

# Verify proof with helper
node finance/tools/verify_proof.js --proof /tmp/ledger-proof.json --public-key /tmp/pub.pem

# Run unit ledger tests
cd finance && npm ci && npm test
```

---

## References

* Audit verification utility: `kernel/tools/audit-verify.js`. 
* Signing & key rotation references: `docs/kms_iam_policy.md`, `docs/key_rotation.md`. 

---

If you want, I can now produce `finance/docs/RECONCILIATION.md` (next), or generate the CI workflow `.github/workflows/finance-ci.yml`. Which should I do?

