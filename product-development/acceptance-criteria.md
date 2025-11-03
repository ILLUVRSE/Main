```markdown
# Product & Development — Acceptance Criteria

> **Scope**: Defines the verifiable conditions for accepting the **Product & Development** module. Derived from the acceptance section of `product-development-spec.md`.

---

## Final Acceptance Statement
Product Development is accepted when all below criteria pass in a staging or prod-equivalent environment, automated tests are green, audit integrity is verified, and formal sign‑off is recorded by **Ryan (SuperAdmin)**, **Security Engineer**, and **Legal** (if PII or contractual flows exist).

---

## Preconditions
- Kernel, Memory Layer, Reasoning Graph, and Eval Engine are active and reachable.
- Audit Bus and KMS signing proxy are operational.
- Finance and Legal services are reachable for contract validation.

---

## Acceptance Checklist (must all pass)
- [ ] **Idea ingestion flow** works: `POST /product/idea` stores record with metadata and emits signed AuditEvent.
- [ ] **Discovery phase** logs all research artifacts in the Memory Layer and links them to ideaId.
- [ ] **Experiment lifecycle** endpoints operational: `POST /product/experiment` creates experiment; results link to Eval Engine metrics.
- [ ] **Experiment result capture** verified: results are canonicalized, signed, and pushed to Reasoning Graph.
- [ ] **MVP creation flow** executes end-to-end and produces Kernel Manifest.
- [ ] **MVP handoff** process emits audit chain linking idea → discovery → MVP → manifest.
- [ ] **Product promotion gating** works: requires Eval Engine approval, SentinelNet risk check, and Kernel multisig for high-risk items.
- [ ] **Handoff record** is accessible and immutable; Audit verifier proof passes.
- [ ] **Legal/PII safeguards** verified: if product data contains PII, SentinelNet policy enforcement blocks any unapproved export.
- [ ] **Rollback workflow** exists for reversing a promoted product if SentinelNet later flags it.

---

## Objective Test Cases
1. **Idea submission:** Submit an idea → verify persistence, AuditEvent recorded, and checksum signed.
2. **Discovery integration:** Upload linked research docs → verify stored in Memory Layer and idea node updated with link hashes.
3. **Experiment execution:** Create an experiment → attach results → Eval Engine metrics received; snapshot stored in Reasoning Graph.
4. **MVP build:** Convert experiment → MVP manifest → verify manifest signature and multisig apply flow.
5. **Promotion gating:** Attempt promotion with and without required Eval Engine and SentinelNet approvals; expected block for missing approvals.
6. **Audit chain verification:** Run audit verifier; confirm full chain (idea→discovery→MVP→handoff) validates.
7. **Rollback:** Trigger SentinelNet alert → rollback flow restores previous stable version and posts reversal audit.

---

## Evidence to Attach in Final PR
- CI job links for unit/integration/e2e tests.
- Audit verifier proof for a completed product lifecycle.
- Snapshot of MVP Manifest with Kernel signature.
- SentinelNet policy decision logs for at least one blocked promotion.
- Evidence of rollback execution (audit events + confirmation logs).
- Legal/PII compliance checklist (if applicable).

---

## Sign-offs (recorded as AuditEvents or PR approvals)
- Security Engineer: ☐  
- Legal: ☐  
- Ryan (SuperAdmin): ☐
```

