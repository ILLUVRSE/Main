# Multisig Payout Policy

High-value payouts must be explicitly approved by multiple roles before release to the payout provider.

## Thresholds
- Payouts < $10,000: FinanceLead + automated Stripe risk checks. No human multisig required but audit log entry mandatory.
- $10,000 – $250,000: FinanceLead + SecurityEngineer approvals.
- > $250,000 or any manual override: FinanceLead + SecurityEngineer + SuperAdmin (3 of 3) plus out-of-band verbal confirmation.

## Workflow Summary
1. FinanceLead creates payout via `POST /finance/payout`.
2. Payout stored with status `pending_approval`. Audit event recorded.
3. Approvers receive notification (Slack + email) with hash of payout payload.
4. Each approver signs payload hash using hardware-backed key; signature submitted via `POST /finance/payout/{id}/approvals`.
5. `payoutService.ts` tracks approvals; once quorum reached, it triggers settlement through `payoutProviderAdapter.ts` and signs proof manifest via `signingProxy.ts`.

## Constraints
- Approvals expire after 24 hours; stale approvals require re-signing.
- Approvers cannot approve a payout they initiated.
- Signing proxy enforces quorum before generating final signature bundle.
- Every approval writes an immutable record in `audit_events`.

## Incident Handling
- Any rejected payout requires incident ticket referencing payout ID, reason, and remediation steps.
- If a key compromise is suspected, disable role in OIDC, rotate mTLS cert, and revoke KMS grant per `infra/kms_policy.json`.
