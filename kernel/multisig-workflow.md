# Kernel — Multi-Sig Upgrade Workflow

Purpose: define the concrete, auditable process for approving and applying Kernel-level upgrades (code, manifests, governance changes) using a 3-of-5 multi-signature workflow. Keep it tight: unambiguous steps, required artifacts, fail-safe behavior, and audit requirements.

---

## # Summary (one line)
Kernel core upgrades require **3-of-5** signed approvals from designated approvers; the workflow produces a single signed upgrade artifact and an immutable audit record before any change is applied.

---

## # Approver set
- **Primary approver pool (5 total)**: SuperAdmin (Ryan) + 4 appointed approvers drawn from Division Leads / Security Engineer / Technical Lead.
- Approver identities are fixed in the Kernel Key Registry and resolved to signer IDs (e.g., `ryan`, `sec-eng`, `tech-lead`, `divlead-1`, `divlead-2`).

**Quorum**: any **3** distinct approvers from the pool.

---

## # Artifacts to be produced for every upgrade
1. **Upgrade Manifest** (required): JSON object describing:
   - `upgradeId` (uuid)
   - `type` (`code|manifest|policy|rollback`)
   - `target` (repository, path, commit hash or manifest id)
   - `rationale` (short text)
   - `impact` (components affected, downtime expectations)
   - `preconditions` (tests required, approvals required)
   - `timestamp`
   - `proposedBy` (id)
2. **Binary / Patch Hash**: SHA-256 of the code package or manifest diff.
3. **Approval Record** (one per approver): signed small JSON containing `upgradeId`, `approverId`, `approvalTs`, and optional `notes`.
4. **Quorum Bundle**: the Upgrade Manifest + list of at least 3 valid Approval Records + combined metadata. The Kernel signs the Quorum Bundle to produce the **AppliedUpgradeRecord**.

All artifacts are canonicalized, hashed, and signed. They are stored in the audit bus and in the upgrade registry.

---

## # Normal approval flow (step-by-step)
1. **Prepare upgrade**: Requestor (Technical Lead or Operator) creates the Upgrade Manifest and uploads code/patch to a secure artifact store; compute `patchHash`. This is recorded as a draft upgrade event on the audit bus.
2. **Run automated checks**: CI runs unit tests, integration tests, security scans, and canary simulations as required by `preconditions`. CI posts test results to the draft upgrade event. If tests fail, the upgrade is paused.
3. **Request approvals**: Requestor uses CommandPad to submit the Upgrade Manifest for approval. The Kernel issues a `pending-approval` upgrade event. All approvers are notified.
4. **Approvers review**: Each approver reviews artifacts, test results, and rationale. If approving, approver signs an Approval Record (via KMS/HSM or UI) and submits it to the Kernel. If rejecting, approver records a rejection event with reason.
5. **Quorum collected**: Once 3 valid Approval Records exist, Kernel builds the Quorum Bundle, validates signatures, verifies `patchHash` against artifact store, and re-runs a final verification (checks policies via SentinelNet, budget constraints, etc.).
6. **Apply upgrade**: If checks pass, Kernel writes the AppliedUpgradeRecord to the audit bus, applies the change (deploys code, updates manifest), and marks the upgrade as `applied`. The apply step is atomic where possible: write audit, deploy, confirm.
7. **Post-apply validation**: Run smoke tests and canary verification. If issues are detected, either auto-trigger rollback (if policy says so) or escalate for manual rollback with another multi-sig flow.
8. **Complete**: Emit final signed audit event `upgrade.complete` with results, signatures, and links to logs.

---

## # Rollback flow
- **Rollback is also a multi-sig upgrade**: create a `type: rollback` Upgrade Manifest referencing `target` (previous version) plus `reason`. The same 3-of-5 approval flow applies.
- **Emergency rollback**: if severe failure detected, SecurityEngineer or SuperAdmin may trigger an emergency rollback procedure (see Emergency section). Emergency rollback still requires signed audit events; if possible the system collects approvals retroactively and records the rationale.

---

## # Emergency (break-glass) path
- **Who can trigger**: SuperAdmin (Ryan) or SecurityEngineer.
- **What happens**:
  1. Trigger emergency apply via CommandPad — Kernel records `emergency=true` on the upgrade manifest.
  2. Kernel applies the change immediately but marks state `emergency_applied`.
  3. Kernel emits a high-priority audit event and notifies approvers and auditors.
  4. Within a short window (configurable, e.g., 48 hours), the requester must obtain retroactive multi-sig approvals (3-of-5) to ratify the emergency change. If ratification fails within window, an automated rollback is scheduled.
  5. All emergency actions are logged and subject to post-incident review.

**Note:** Emergencies are expensive and audited; use them only for critical remediation.

---

## # Verification & validation rules
- Kernel verifies:
  - Each Approval Record signature against `approverId` public key.
  - `patchHash` matches artifact.
  - SentinelNet policy passes for the upgrade (no blocked operations).
  - There are no unmet preconditions (failed tests).
- If any verification fails, the upgrade is rejected and a `upgrade.rejected` audit event is emitted with reasons.

---

## # Storage & audit
- Store Upgrade Manifests, Approval Records, and AppliedUpgradeRecord in the upgrade registry (immutable).
- Emit audit events for each state transition: `upgrade.created`, `approval.submitted`, `upgrade.quorum_reached`, `upgrade.applied`, `upgrade.completed`, `upgrade.rejected`, `upgrade.rollback`.
- All artifacts and audit events are chained and signed per the Audit Log Spec.

---

## # UI / CommandPad interaction (brief)
- CommandPad shows pending upgrades, their artifacts, test results, and approval buttons.
- Approvers may view diffs or download artifacts; approval is a signed action in the UI (or via CLI) that submits the Approval Record.
- The UI forbids approving if SentinelNet flags a policy violation; approver can add notes or request further tests.

---

## # Tests & automation
- Unit tests for signature validation, quorum building, and hash verification.
- Integration tests simulate full approval flows: normal apply, rejection, and rollback.
- Chaos test: simulate lost approvals, unavailable approvers, and ensure system waits and does not apply partial upgrades.
- Canary automation: after apply, run canary jobs and auto-fail on SLA regressions.

---

## # Edge cases & rules
- **Stale approvals**: Approval Records older than a configured TTL (e.g., 14 days) are invalid — approvers must re-approve.
- **Approver unavailability**: If an approver leaves, reconfigure the approver pool and reassign; re-approval of any pending upgrades may be required.
- **Partial approvals**: Only a complete quorum (3 valid approvals) allows apply. Two approvals do nothing.
- **Signature mismatch**: Any signature that fails verification invalidates the approval and is logged; approver must re-submit.
- **Duplicate approvals**: Only one approval per approver per upgrade is counted.

---

## # Acceptance criteria
- Workflow documented and implemented in Kernel UI and API.
- Kernel verifies signatures and rejects invalid approvals.
- System enforces 3-of-5 quorum strictly.
- Audit events emitted for every step with correct hash/signature fields.
- Emergency workflow functions and auto-ratification/rollback enforced.
- Tests cover normal, rollback, and emergency scenarios.

---

## # Example (short)
1. `upgrade-42` created (manifest + patchHash).
2. CI passes. `approval` from `ryan`, `divlead-1`, `sec-eng`.
3. Kernel validates signatures, SentinelNet OK → applies upgrade and emits `upgrade.applied`.
4. Canary fails → Kernel triggers `upgrade.rollback` with new rollback manifest, undergoes 3-of-5 approval, rollback applied.

---

End of file.

