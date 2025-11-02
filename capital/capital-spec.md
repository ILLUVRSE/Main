# Capital & Investments — Specification

## Purpose
Manage internal and external funding operations: sourcing deals, underwriting, portfolio management, allocations, exits, and automated capital flows. Provide auditable, policy-driven investment operations that integrate with Kernel for governance, SentinelNet for compliance, and Finance for ledgering.

---

## Core responsibilities
- Deal sourcing & intake: ingest opportunities, track provenance and documents.  
- Underwriting & evaluation: run quantitative/qualitative scoring, risk models, and produce investment memos.  
- Allocation & execution: allocate capital to internal divisions, projects, and external deals; enforce budgetary rules and multisig approvals.  
- Portfolio management: track holdings, valuations, performance metrics (IRR, MOIC), and exits.  
- Fund accounting & reporting: integrate with Finance to ensure correct ledger entries and reporting.  
- Escrow & payouts for exits: manage proceeds distribution, fees, and payouts to stakeholders.  
- Governance & compliance: KYC/AML hooks for external investments, multi-sig gating for allocations above thresholds, and audit traceability.

---

## Minimal public APIs (intents)
All calls Kernel-authenticated (mTLS) or via the Capital UI with RBAC.

- `POST /capital/deals` — register a sourced deal (metadata, docs, source).  
- `GET  /capital/deals/{id}` — fetch deal record and underwriting history.  
- `POST /capital/underwrite` — submit underwriting analysis and score (dealId, modelOutputs, recommendation).  
- `POST /capital/allocate` — request or execute an allocation (dealId|divisionId, amount, currency, tranche, rationale). Returns `allocationId`.  
- `POST /capital/approve` — approve allocation (used for multisig approvals).  
- `GET  /capital/portfolio` — list holdings, valuations, and performance.  
- `POST /capital/exit` — register exit event (dealId, exitType, proceeds, fees). Triggers payout workflow.  
- `GET  /capital/valuation/{id}` — fetch valuation history and supporting evidence.  
- `POST /capital/report` — generate P&L, cashflow, and fund reports for period/jurisdiction.

**Notes:** Every mutating call must emit AuditEvents; high-value allocations require multisig (see governance).

---

## Canonical data models (short)

### Deal
- `dealId`, `name`, `source`, `stage` (`sourced|underwriting|approved|funded|exited`), `documents[]` (docIds), `valuation`, `proposedAmount`, `currency`, `kpis`, `createdAt`, `metadata`.

### UnderwriteRecord
- `id`, `dealId`, `analystId`, `score` (numeric), `modelOutputs` (json), `riskRating`, `recommendation` (`invest|pass|watch`), `ts`, `evidenceRefs`.

### Allocation
- `allocationId`, `entityId` (dealId or divisionId), `amount`, `currency`, `tranche`, `status` (`requested|pending|approved|applied|rejected`), `requestedBy`, `approvals[]` (signerId, ts), `appliedAt`.

### PortfolioPosition
- `positionId`, `dealId`, `ownershipPct`, `costBasis`, `currentValuation`, `unrealizedPL`, `realizedPL`, `createdAt`, `updatedAt`.

### ExitRecord
- `exitId`, `dealId`, `exitType` (`sale|merger|ipo|liquidation`), `proceeds`, `fees`, `netProceeds`, `ts`, `payouts[]`.

---

## Processes & rules

### Deal lifecycle
1. Source → register with docs → initial screening.  
2. Underwriting: quantitative models + human memo → UnderwriteRecord.  
3. Approval: if recommended, allocation request is created; SentinelNet and Capital governance checks run.  
4. Funding: upon multisig and Finance confirmation, funds are reserved and applied (ledger entries recorded).  
5. Monitor: portfolio tracking, performance updates, follow-on allocations if warranted.  
6. Exit: execute exit workflow and distribute proceeds.

### Allocation governance
- Thresholds determine approval flow:
  - Low: single DivisionLead approval.  
  - Medium: 2-of-3 approvals (DivisionLead + CapitalLead + Finance).  
  - High: 3-of-5 multisig (uses Kernel multisig workflow).  
- SentinelNet compliance checks (KYC, AML, sanctions, budget caps) run before final apply.  
- Capital allocations tied to specific budget lines and must reconcile with Finance ledger.

### Valuation & reporting
- Valuations recorded with evidence (cap table, market comps, model assumptions) and timestamped.  
- Periodic marking and reporting (monthly/quarterly) with exportable audit packages for auditors.

### Exits & payouts
- Exit flows produce ledger entries: de-recognition of holdings, cash inflow, fees accruals, payouts.  
- Payouts scheduled and executed via Finance payout mechanisms, with audit trails and fee breakdowns.

---

## Compliance & KYC
- External deals require KYC/AML checks; integrate third-party KYC providers and store evidence refs (not raw PII).  
- Sanctions screening for counterparties and counterpart entity validation.  
- All compliance checks logged and produce `policyCheck` entries via SentinelNet when applicable.

---

## Audit & immutability
- All deal records, underwriting, approvals, allocations, and exits are immutable records appended to the audit bus.  
- Allocation approvals and applied allocations include ManifestSignature references and are cryptographically verifiable.

---

## Integration points
- **Kernel**: multisig flows, manifest signing, and audit bus.  
- **Finance**: ledger entries for allocations, escrow, fees, payouts, and reconciliation.  
- **SentinelNet**: compliance checks (KYC/AML/sanctions) and policy enforcement.  
- **Legal**: for contract generation/approval and document signatures.  
- **Marketplace/Product Divisions**: for strategic investments into internal product initiatives.

---

## Acceptance criteria (minimal)
- Deal registration and underwriting flows implemented; UnderwriteRecord stored with evidence.  
- Allocation request → multisig approval → apply flow works and produces Finance ledger entries.  
- SentinelNet blocks non-compliant allocations (simulate KYC/sanctions fail).  
- Portfolio view shows positions with valuations and P&L.  
- Exit flow runs and triggers payouts via Finance; audit trail recorded.  
- KYC/AML integration simulated and evidence pointers stored.  
- High-value allocations require multisig per governance and fail without quorum.

---

## Security & governance
- KYC evidence stored as pointer refs; PII handled per legal requirements (redaction and restricted access).  
- High-value actions require multisig and Finance confirmation.  
- All actions auditable and signed (ManifestSignature where relevant).  
- Capital service runs in isolated environment with mTLS and strict RBAC.

---

## Example flow (short)
1. Deal `crypto-startup` registered with documents.  
2. UnderwriteRecord indicates `score=0.78`, `recommend: invest`, `risk: medium`.  
3. Allocation requested for $2M. SentinelNet runs sanctions/KYC checks — pass.  
4. Allocation requires multisig (3-of-5). Approvals collected.  
5. Finance confirms funds and ledger entries posted. Allocation `applied` and portfolio position created.  
6. Later, exit executed; proceeds recorded, fees applied, payouts run, and audit events generated.

---

End of file.

