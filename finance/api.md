# Finance Service API

The Finance Service exposes a TLS-only, mTLS-enforced REST API for posting journal entries, initiating payouts with multisig approval, and retrieving signed proofs covering a ledger interval. All endpoints require mutually authenticated TLS plus a bearer token that maps to a role defined in `security/roles_and_permissions.md`. Requests are idempotent via the `Idempotency-Key` header.

## Authentication and Headers
- `Authorization: Bearer <token>` — issued through the OIDC provider described in `config/oidc_config.yaml`.
- `Idempotency-Key` — caller-provided UUID to guarantee at-most-once semantics for mutation endpoints.
- `X-Signer-Role` — required for payout approvals to assert the human approver’s RBAC role.

## Endpoints

### POST /finance/journal
Posts one or more double-entry journal entries atomically.

**Body**
```json
{
  "entries": [
    {
      "journalId": "uuid",
      "batchId": "uuid",
      "timestamp": "2024-01-01T00:00:00Z",
      "currency": "USD",
      "lines": [
        { "accountId": "cash", "direction": "debit", "amount": "100.00" },
        { "accountId": "revenue", "direction": "credit", "amount": "100.00" }
      ],
      "metadata": { "source": "marketplace", "orderId": "o123" }
    }
  ]
}
```

**Responses**
- `201 Created` with committed journal IDs.
- `400` when entries are unbalanced or invalid.
- `409` when an idempotency key already exists with conflicting payload.

### POST /finance/payout
Initiates a payout request routed through multisig approval and payout provider settlements.

**Body**
```json
{
  "payoutId": "uuid",
  "invoiceId": "inv_123",
  "amount": "2500.00",
  "currency": "USD",
  "destination": {
    "provider": "stripe",
    "accountReference": "acct_123"
  },
  "memo": "royalty payment",
  "requestedBy": "user@example.com"
}
```

**Responses**
- `202 Accepted` with approval status `pending`, plus quorum definition.
- `403` when caller role lacks permission.
- `409` if payout already exists.

### POST /finance/payout/{payoutId}/approvals
Captured by `payoutApprovalController.ts`. Allows finance/security approvers to record a signature.

**Body**
```json
{
  "approver": "finance.lead@example.com",
  "role": "FinanceLead",
  "signature": "base64-ed25519",
  "comment": "looks good"
}
```

Responses mirror multisig policy: `202` when quorum not yet met, `200` when payout is released, `409` on conflicting approvals.

### GET /finance/proof
Retrieves a canonical signed proof package for a ledger interval.

Query params: `from` (ISO timestamp), `to` (ISO timestamp), optional `format` (`json`|`tar`).

Return value is described in `exports/proof-package-spec.md`. Includes:
- Canonical ledger slice
- Hash chain manifest
- Detached signature bundle produced via `signingProxy.ts`

### Errors
Errors follow RFC 7807 problem detail objects with `code`, `message`, `correlationId`, and optional `details` array. Authentication failures emit `401`, authorization `403`, validation `400`, and internal errors `500`.

## Pagination & Limits
Ledger and proof queries support pagination via `nextCursor`. Posting APIs limit payloads to 500 journal lines per request and 100 payouts per minute per tenant.

## Idempotency & Retries
Clients must retry with the same `Idempotency-Key` to handle transient failures. The service stores keys for 24 hours.

## Rate Limiting
Per-role quotas enforced by API Gateway:
- Journal posting: 50 requests/sec service-wide.
- Payout initiation: 5 requests/sec.
- Proof retrieval: 10 requests/sec.

Refer to `api/openapi.yaml` for the formal schema.
