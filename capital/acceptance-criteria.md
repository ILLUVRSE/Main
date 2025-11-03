# Capital & Investments — Acceptance Criteria

Purpose: short, verifiable checks proving the Capital & Investments module is correct, auditable, compliant, and production-ready. Each item is actionable, testable, and scoped to Capital responsibilities.

---

# # 1) Deal registration & documents
- **Requirement:** Register a deal with metadata and document pointers; documents stored in S3 with object-lock and evidence pointers in DB.
- **How to verify:** Create a deal with sample documents; verify DB record and S3 objects exist with correct metadata and immutability flags.

# # 2) Underwriting & evidence
- **Requirement:** UnderwriteRecord stored with analyst info, model outputs, risk rating, and evidence refs. Underwrite results are auditable.
- **How to verify:** Submit underwriting for a deal and confirm UnderwriteRecord exists, contains expected fields, and an AuditEvent is emitted.

# # 3) Allocation request lifecycle
- **Requirement:** Allocation request → SentinelNet compliance check → approval workflow (threshold-based) → Finance reservation → apply. Allocation must be blocked if any step fails.
- **How to verify:** Request allocation; simulate SentinelNet fail → request blocked. Simulate normal flow, collect approvals, confirm Finance reservation and `applied` status and audit trail.

# # 4) Multisig enforcement
- **Requirement:** High-value allocations require 3-of-5 multisig; workflow enforces quorum and rejects apply without it.
- **How to verify:** Attempt high-value allocation without quorum — should be rejected. Collect 3 valid approvals and confirm allocation proceeds.

# # 5) SentinelNet & compliance checks
- **Requirement:** KYC/AML/sanctions checks run pre-allocation; failing checks block allocations and produce `policyCheck` audit events.
- **How to verify:** Simulate KYC failure and confirm allocation blocked and `policyCheck` exists with rationale.

# # 6) Finance integration & reconciliation
- **Requirement:** Allocation apply posts reservations and final ledger entries to Finance; daily reconciliation can confirm matching records.
- **How to verify:** Run allocation through to apply and confirm Finance ledger entries; run reconciliation and ensure no mismatches in sample dataset.

# # 7) Portfolio tracking & valuations
- **Requirement:** Portfolio positions created on apply; valuations and P&L computed and stored with evidence.
- **How to verify:** After allocation, verify portfolio entry exists and a valuation update can be recorded and retrieved with supporting evidence.

# # 8) Exit & payout workflow
- **Requirement:** Exit flow records exit, computes proceeds/net, posts ledger entries, and triggers payout to stakeholders via Finance. Audit trail must record the whole flow.
- **How to verify:** Register an exit event, confirm ledger entries and payout job creation, and verify audit events for each step.

# # 9) KYC evidence & PII handling
- **Requirement:** KYC evidence stored as pointers (not raw PII), protected with restricted access. Evidence used in decisioning but not exposed.
- **How to verify:** Run KYC integration test: provider returns evidence pointer; confirm pointer stored and raw PII not present in DB. Attempt unauthorized access and confirm denial.

# # 10) Audit & immutability
- **Requirement:** Deal registration, underwriting, approvals, allocations, and exits emit AuditEvents. ManifestSignature linkage exists where appropriate and entries are verifiable.
- **How to verify:** For a full deal lifecycle, pull corresponding AuditEvents, verify signatures/hashes, and verify manifestSignature references.

# # 11) Error handling & idempotency
- **Requirement:** External callbacks (KYC, Finance, multisig approvals) are idempotent and correlated by stable request ids. Duplicate callbacks do not create duplicate allocations or approvals.
- **How to verify:** Replay the same callback twice and confirm single effect (no duplicates).

# # 12) Runbook & failover drills
- **Requirement:** Runbooks exist for approval backlog, reconciliation mismatch, KYC outages, multisig recovery, and emergency rollback. Team can execute a restore or mitigation drill.
- **How to verify:** Perform an approval backlog drill and a reconciliation mismatch drill with operator playbooks; confirm expected outcomes and logs.

# # 13) Observability & alerts
- **Requirement:** Metrics available: allocation requests/sec, approval latency, multisig wait time, KYC turnaround, reconciliation lag. Alerts configured for abnormal conditions.
- **How to verify:** Validate dashboards and simulate conditions to trigger alerts (e.g., delayed KYC responses).

# # 14) Security & governance
- **Requirement:** mTLS + RBAC enforced for all service calls; high-value actions require multisig and legal/Finance involvement. KMS/HSM signing employed where required.
- **How to verify:** Attempt unauthorized allocate/apply calls and confirm rejection; verify signing via KMS for approval artifacts.

# # 15) Documentation & sign-off
- **Requirement:** `capital-spec.md`, `deployment.md`, `README.md`, and this acceptance file are present. Security Engineer, Finance lead, and Ryan sign off on capital governance.
- **How to verify:** Confirm presence of files and obtain written sign-off recorded as an AuditEvent.

---

# # Final acceptance statement
Capital module is accepted when all above criteria pass in a staging environment, audit integrity is verified, SentinelNet checks function, multisig enforcement works for high-risk flows, Finance integration reconciles correctly, and formal sign-off from Security Engineer, Finance lead, and Ryan is recorded.


