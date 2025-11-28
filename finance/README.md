# Finance & Billing — Core Module

## # Purpose
Finance is responsible for the double-entry ledger, invoicing, payments, escrow, royalties, tax reporting, and cryptographically auditable proofs. Finance guarantees accounting correctness, signed exportable proofs, and governed flows for high-risk financial actions.

## # Location
All files for Finance live under:
`~/ILLUVRSE/Main/finance/`

## # Files in this module
- `finance-spec.md` — core finance specification (already present).  
- `README.md` — this file.  
- `deployment.md` — deployment & infra guidance (to be created).  
- `api.md` — API surface and examples (to be created).  
- `acceptance-criteria.md` — testable checks for Finance (to be created).

## # How to use this module
1. Read `finance-spec.md` to understand ledger model, journal entries, invoice lifecycle, escrow rules, royalty splits, and audit-proof expectations.  
2. Implement Finance as an isolated service with its own DB and strict access controls. Provide:
   * A double-entry journal API that ensures every posted journal entry balances.  
   * Signed proofs for ledger ranges (hash chains + signatures via KMS/HSM).  
   * Export formats for auditors and reconciliation tooling.  
   * Integration points for Marketplace (orders), Payment Provider (Stripe), and Payout orchestration.

## # Local orchestration
Run `./finance/run-local.sh` to spin up the express-based mock Finance API (`finance/mock/financeMockServer.js`) along with disposable dependencies:

- Postgres (`START_POSTGRES=true`, overridable via `POSTGRES_DB|USER|PASSWORD|PORT`)
- MinIO/S3 (`START_MINIO=true` unless `S3_ENDPOINT` already provided)
- Signing proxy mock (`MOCK_SIGNING_PROXY=true`)

The script writes process/container metadata under `/tmp/finance-run-local.*`, exposes the service on `http://127.0.0.1:8050`, and accepts `teardown` to stop anything it started. You can disable individual bits via `START_FINANCE_MOCK=false` or `START_MINIO=false` when you only need infra primitives (e.g., the CI audit job). To run the real Finance service locally, export `DATABASE_URL`, `S3_AUDIT_BUCKET`, and signer/KMS envs, then run `npx ts-node finance/service/src/server.ts` (or `tsx finance/service/src/server.ts`) from the repo root. For audit chores, feed proof JSON + PEM files into `node finance/tools/verify_proof.js --proof <file> --public-key <pem>` to ensure the recorded signatures verify before handing artifacts to auditors.

### Proof helper (CI)

`finance/tools/ci_generate_and_verify_proof.sh` wraps `generate_ledger_proof.sh` and `kernel/tools/audit-verify.js` so CI can:

1. Point at a Postgres URL (`DATABASE_URL` env),
2. Generate `proof.json` for a `[from,to]` window via `SIGNING_PROXY_URL` or `AUDIT_SIGNING_PRIVATE_KEY`,
3. Run `audit-verify` against `kernel/tools/signers.json`.

The script exits non-zero if any step fails, producing the proof at `finance/ci-proof.json` by default.

## # Security & governance
- Finance must run in a high-trust isolated environment.  
- Use KMS/HSM for signing ledger proofs and never export private keys.  
- mTLS for service-to-service calls and OIDC/SSO with 2FA for human access.  
- High-value actions require multisig approval and must be auditable.

## # Audit & compliance
- Ledger segments, invoices, payments, and payouts must be exportable as canonicalized, signed packages for auditors.  
- Retain ledger and audit archives per legal policy and provide verification tools for signatures and hash chains.

## # Acceptance & sign-off
Finance is accepted when ledger integrity and settlement flows are proven: balanced journal entries, invoice lifecycle and payment integration implemented, payout flows and escrow handling tested and signed proofs published. Final approver: **Ryan (SuperAdmin)**. Finance Lead and Security Engineer must sign off.

## # Next single step
Create `deployment.md` describing the isolated topology, DB encryption, signing proxy details, and reconciliation/export tooling. When ready, reply **“next-finance”** and I’ll produce the file.
