# Capital & Investments — Core Module

## Purpose
This directory contains the Capital & Investments artifacts for ILLUVRSE: deal sourcing, underwriting, allocation and execution, portfolio management, exits, KYC/AML compliance, and integration with Finance and Kernel governance. Capital operations are high-trust and must be auditable and policy-driven.

## Location
All files for Capital live under:



~/ILLUVRSE/Main/capital/


## Files in this module
- `capital-spec.md` — core specification (already present).  
- `README.md` — this file.  
- `deployment.md` — deployment & infra guidance (to be created).  
- `api.md` — API surface and examples (to be created).  
- `acceptance-criteria.md` — testable checks for Capital (to be created).  
- `.gitignore` — local ignores for runtime files (to be created).

## How to use this module
1. Read `capital-spec.md` to understand the full lifecycle: deal intake, underwriting, allocation governance, portfolio tracking, exits, and compliance.  
2. Implement the Capital service to register deals, run underwriting, create allocation requests, record approvals, and integrate with Finance for funds and payouts.  
3. Enforce multisig and SentinelNet checks for allocations; ensure all actions produce AuditEvents and link to ManifestSignatures where appropriate.  
4. Integrate KYC/AML providers and store evidence pointers (not raw PII). Use SentinelNet for policy checks and Kernel multisig for high-value approvals.

## Security & governance
- Capital is a high-trust service: isolate it in its own environment, enforce mTLS, strict RBAC, and OIDC for human access.  
- High-value allocations and exits require multisig approval (3-of-5 or other configured thresholds).  
- KYC/AML evidence is stored as pointers; PII is protected and access-restricted.  
- All approvals and allocations must be auditable and signed.

## Integration & audit
- Kernel: multisig workflows, manifest signatures, and audit bus integration.  
- Finance: ledger entries for allocations, escrow, payouts, and reconciliations.  
- SentinelNet: compliance checks (KYC, sanctions, AML).  
- Legal: contract generation and document signing for investments.  
- Portfolio and reporting: integrate with Finance for P&L and reporting.

## Acceptance & sign-off
Capital module is accepted when:
- Deal registration, underwriting, allocation request, multisig approval, and apply flow functions end-to-end and emits AuditEvents.  
- SentinelNet blocks non-compliant allocations.  
- Portfolio positions and exit flows integrate with Finance with correct ledger entries.  
- KYC/AML evidence pointers are stored and used in compliance checks.  
Final approver: **Ryan (SuperAdmin)**. Security Engineer and Finance lead must review operational and compliance integration.

## Next single step
Create `deployment.md` for Capital (one file). When you’re ready, reply **“next”** and I’ll provide the exact content for that single file.

---

End of README.

