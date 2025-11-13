# Reasoning Graph — Core Module

## # Purpose
The Reasoning Graph stores explainable, versioned causal/decision graphs used by the Kernel to record WHY decisions were made. It provides queryable traces, snapshotting, and signed proofs for audits and human inspection. It complements the Audit Log by organizing events into causal structure and annotations.

## # Location
All files for the Reasoning Graph live under:
~/ILLUVRSE/Main/reasoning-graph/

## # Files in this module
- `reasoning-graph-spec.md` — canonical specification (nodes, edges, traces, snapshots, APIs, signing, and governance).
- `README.md` — this file.
- `deployment.md` — deployment guidance and infra notes (to be created).
- `api.md` — API surface and examples (to be created).
- `acceptance-criteria.md` — testable checks for the Reasoning Graph (to be created).
- `.gitignore` — local ignores for runtime files (to be created).

## # How to use this module
1. Read `reasoning-graph-spec.md` to understand the models (ReasonNode, ReasonEdge, ReasonTrace) and required APIs.
2. Implement a service that accepts Kernel-authorized writes (nodes/edges), computes traces, creates signed snapshots, and exports traces for auditors.
3. Ensure every write produces an AuditEvent linking node IDs to kernel-signed manifests per the Audit Log spec.
4. Integrate with Eval Engine, Agent Manager, SentinelNet, and ControlPanel to record recommendations, policy checks, decisions, and annotations.

## # Security & governance
- Writes only through Kernel (mTLS + RBAC).
- Snapshots and important decision nodes must be hashed and signed; signer IDs tracked in Key Registry.
- PII must be redacted per SentinelNet policy before traces are returned to non-authorized viewers.
- All corrections must be append-only (create correction nodes) and produce audit events.

## # Acceptance & sign-off
Reasoning Graph is accepted when:
- Spec endpoints work and only accept Kernel-authorized writes.
- Trace queries return ordered, annotated causal paths and handle cycles safely.
- Snapshots produce canonical hash + signature and are verifiable.
- Integration tests with Eval Engine, Agent Manager, and SentinelNet pass.
Final approver: **Ryan (SuperAdmin)**. Security Engineer must review signing and PII policies.

## # Next single step
Create `deployment.md` for the Reasoning Graph (one file). When you’re ready, reply **“next”** and I’ll give the exact content for that single file.

---

End of README.

