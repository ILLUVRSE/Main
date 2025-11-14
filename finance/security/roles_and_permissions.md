# Roles and Permissions

Finance leverages OIDC-issued JWTs plus hardware-backed WebAuthn for MFA. Each human role maps to specific scopes consumed by the Finance Service’s RBAC middleware.

## Roles

| Role | Description | Key Capabilities |
| --- | --- | --- |
| FinanceLead | Owns ledger integrity and payout release | Post journal entries, initiate payouts, approve payouts (1 of 2), trigger exports |
| SecurityEngineer | Oversees signing keys, monitors KMS | Approve payouts (2 of 2), manage signing proxy, run restoration drills |
| SuperAdmin | Ryan, emergency break-glass | Override approvals, rotate keys, run acceptance checklist |
| ReadOnlyAuditor | External auditors | Fetch proofs, download exports, run verifier CLI |

## Authentication Flow
1. User signs in via OIDC provider defined in `config/oidc_config.yaml`.
2. MFA enforced via WebAuthn or OTP token; session bound to hardware key.
3. Access token contains `roles` claim referencing above roles; Finance service inspects claim.
4. mTLS ensures service-to-service trust when automation (e.g., marketplace adapter) calls the API.

## Permissions Matrix
- Journal Controller: `FinanceLead`, system service accounts with scope `ledger:write`.
- Payout Controller: `FinanceLead` for initiation, `SecurityEngineer` for policy overrides.
- Approval Controller: `FinanceLead`, `SecurityEngineer`, `SuperAdmin`.
- Proof retrieval: `FinanceLead`, `ReadOnlyAuditor`, `SecurityEngineer`, `SuperAdmin`.

## Human Approver Definitions
- **Finance Lead** — must be on-call rotation, 2FA enforced, hardware token required.
- **Security Engineer** — separate trust domain from Finance; no shared secrets.
- **SuperAdmin** — only Ryan; requires explicit sign-off recorded in `signoff/finance_signoff_template.md` before using break-glass credentials.

## Operational Requirements
- RBAC rules stored in config repo and synced to Auth0/Okta nightly.
- Access reviews monthly; removal results in automatic revocation of mTLS certificates and OIDC refresh tokens.
- All privileged actions emit audit events via `auditService.ts` and land in `audit_events` table.
