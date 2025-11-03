
# # Files in this module
- `finance-spec.md` — core finance specification (already present).
- `README.md` — this file.
- `deployment.md` — deployment & infra guidance (to be created).
- `api.md` — API surface and examples (to be created).
- `acceptance-criteria.md` — testable checks for Finance (to be created).
- `.gitignore` — local ignores for runtime files (to be created).

## # How to use this module
1. Read `finance-spec.md` to understand the ledger model, invoice lifecycle, escrow, royalties, tax, and audit-proof requirements.
2. Implement Finance as a secure, isolated service with its own DB and strict access controls. All mutating operations must emit Kernel AuditEvents and support multisig gating for high-risk flows.
3. Integrate with Marketplace for orders, with payment providers (Stripe) for payments/refunds, and with Kernel for manifest linkage and multisig workflows.
4. Ensure double-entry journal integrity: every posted journal entry must balance and be cryptographically provable (hash + signature).
5. Provide reconciliation tooling, export formats for auditors, and signed proofs for ledger ranges.

## # Security & governance
- Finance is a high-trust service: run in an isolated environment with strict network controls.
- Use KMS/HSM for signing ledger proofs and rotate keys per policy. Signing keys never leave HSM in plaintext.
- Enforce mTLS for service-to-service calls and OIDC/SSO with 2FA for human access.
- High-value actions (large payouts, escrow release) must require multisig approval and be auditable.

## # Audit & compliance
- Ledger segments, invoices, payments, and payouts must be exportable as canonicalized, signed packages for auditors.
- Retain ledger and audit archives per legal policy and provide verification tools for signatures and hash chains.
- Tax reports and evidence must be generated per jurisdiction with stored supporting documentation.

## # Acceptance & sign-off
Finance is accepted when the acceptance criteria in `finance-spec.md` are implemented and validated: balanced journal entries, invoice lifecycle, payment integration, payout flows, escrow handling, tax reporting, and signed audit proofs. Final approver: **Ryan (SuperAdmin)**. Security Engineer and Finance lead must review and sign off.

## # Next single step
Create `deployment.md` for Finance (one file). When you’re ready, reply **“next”** and I’ll give the exact content for that single file.

---

End of README.

