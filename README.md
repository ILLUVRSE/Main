# ILLUVRSE — Main (monorepo)

**One-line mission**
A governed platform for creating, signing, auditing, and delivering digital artifacts and AI agents — with tools to author packages (IDEA), sign them via a central **Kernel**, publish/deliver them (ArtifactPublisher / RepoWriter → Marketplace), and operate/inspect the system (Control-Panel, Reasoning Graph, SentinelNet, Finance, Memory Layer, Agent Manager, AI-Infra). 

---

## Quick summary (what this repo is)

This repository is the authoritative home for ILLUVRSE’s core platform modules: Kernel, Agent Manager, Memory Layer, Reasoning Graph, Eval Engine, SentinelNet, Marketplace, Finance, AI Infra, ArtifactPublisher/RepoWriter, IDEA, Control-Panel, and supporting artifacts. Each module lives under `~/ILLUVRSE/Main/<module>/` and follows a single-file-at-a-time, auditable workflow. 

**Final approver:** Ryan (SuperAdmin). Security & Finance have required review responsibilities for security-sensitive modules. 

---

## MVP (the one thing to prove)

**MVP:** Make it possible for a creator to build an artifact (IDEA), get it Kernel-signed, list and sell it on Marketplace, and for a buyer to complete checkout and receive a verifiable signed delivery and ledger entry.

**Success metric:** A paying buyer completes checkout and receives an encrypted delivery whose proof (artifact SHA-256 + Kernel signature + finance ledger entry) verifies. See the IDEA and ArtifactPublisher docs for the signing & proof contracts.  

---

## The organizing principle

There are three invariant design rules across this repo:

1. **Kernel is the authority** — orchestration, RBAC, signing, audit, and multisig. All critical writes and promotions go through Kernel. 
2. **Signed, auditable artifacts** — SHA-256 checksums and cryptographic signatures (KMS/HSM or signing proxy) + append-only AuditEvents (sha256 + signature + prevHash) are the canonical proofs. 
3. **Policy + explainability** — SentinelNet enforces deterministic policy and canary rollouts; Reasoning Graph records explainable causal traces for decisions.  

---

## Module reference — role & how it connects (short)

Below are the canonical responsibilities and the way each module coexists with the rest of the platform.

### IDEA

Creator API / local dev server: package authors use IDEA to build artifacts, compute `sha256`, run sandboxes, upload artifacts (S3/MinIO), and request Kernel signatures (sync or async callbacks). IDEA is the canonical producer of agent bundles and the starting point of the golden path. 

### RepoWriter → ArtifactPublisher

* **RepoWriter:** Developer tool to plan & apply multi-file edits with diffs, dry-run, and commit workflows. It is constrained by an allowlist to prevent unsafe repo edits.  
* **ArtifactPublisher (canonical):** The production-grade pipeline for checkout, finance ledgering, signed proofs, license issuance, and encrypted delivery. ArtifactPublisher supersedes RepoWriter for delivery flows and includes E2E and multisig runbooks. 

### Agent Manager

Runtime manager that spawns and controls agents, runs sandboxes, collects telemetry, and emits append-only audit events. Agent Manager accepts Kernel-signed manifests in production and integrates with Memory Layer and Reasoning Graph for observability. 

### AI-Infra

Model training orchestration, model registry, artifact signing, deterministic runners, and promotion gating. Promotions go through SentinelNet and Kernel signing. 

### Control-Panel

Operator UI (Next.js): upgrades dashboard, approvals, SentinelNet verdicts, Reasoning Graph trace review, and audit exploration. Control-Panel proxies signed operator actions through Kernel and keeps secrets server-side. 

### Finance

Double-entry ledger, invoicing, escrow, royalties, and signed ledger proofs. Finance is an isolated, high-trust service that Marketplace and ArtifactPublisher call during checkout and settlement. 

### Kernel

The single source of truth: orchestrator, signer, RBAC, audit emitter, and multisig gate. Everything requiring trust (artifacts, promotions, ledger-relevant actions) flows through Kernel. Kernel enforces signing via KMS/HSM or a signing proxy. 

### Marketplace

Customer-facing listing, preview sandboxes, checkout, license issuance, and integration with Finance and ArtifactPublisher. Marketplace validates Kernel-signed manifests before listing and must audit every order. 

### Memory Layer

Persistent store for vectors (dev: Postgres; prod: pgvector/Milvus/Pinecone), audit archives, and tooling to replay and verify audit chains. Used by Agent Manager, Eval Engine, and other services. 

### Reasoning Graph

Explainable, versioned causal/decision graphs (nodes/edges/traces). Records WHY decisions were made and produces signed snapshots for auditors. Integrates tightly with Kernel, Eval Engine, and Control-Panel. 

### SentinelNet

Low-latency policy engine. Runs JSONLogic rules, deterministic canary rollouts, auto-rollback, and multisig gating for high severity policy changes. Production requires mTLS and RBAC. 

---

## Two diagrams (ASCII)

### Overall architecture (who talks to whom)

```
                    Operators (Control-Panel)
                              |
                              v
                             Kernel  <--- KMS/HSM / Signing Proxy
                             / | \
            mTLS/RBAC  /    |  \   \   Audit Bus (append-only events)  
                       v     v   v
            Agent Manager  SentinelNet  Reasoning Graph
               |   ^          |   ^          ^
               |   |          |   |          |
               v   |          v   |          |
            Agents/ Sandboxes <--+           |
               |                               
IDEA --> Storage (S3/MinIO) --> ArtifactPublisher/RepoWriter --> Marketplace <--> Finance
               \                             ^
                \---------------------------/
                 (signed manifests & proofs)
```

### Golden path — publish & buy (creator → buyer)

```
IDEA (build & sha256) 
  -> upload artifact to Storage
  -> call Kernel sign (artifact_url, sha256, actor)
     -> Kernel signs (KMS/HSM) and emits AuditEvent
  -> ArtifactPublisher / RepoWriter gets signed manifest
  -> Marketplace validates signature & lists SKU
  -> Buyer checkout -> Marketplace calls Finance -> ledger entry
  -> ArtifactPublisher produces encrypted delivery + signed proof
  -> All steps recorded: AuditEvents + Reasoning Graph traces
```

---

## Security, signing & governance — the short version

* **Auth & transport:** Humans = OIDC/SSO; services = mTLS. Production requires mTLS + RBAC. 
* **Signing:** Ed25519 via KMS/HSM or signing proxy; no private keys in repo. Local dev may use mock signers, but production is required to use KMS.  
* **Audit chain:** Every critical action emits an `AuditEvent` (sha256 + signature + prevHash). Reasoning Graph provides explainability for decisions.  
* **Multisig:** High-risk changes use a multisig workflow (3-of-5) coordinated by Kernel + Control-Panel + SentinelNet runbooks. 

---

## Local development & quickstart pointers

Each module includes a `README.md` with its quickstart, acceptance criteria, and runbooks. Start here:

* Kernel: `kernel/README.md` — Kernel API & governance. 
* IDEA: `IDEA/README.md` and `IDEA/server/README.md` — packaging, sandbox, signing contract.  
* ArtifactPublisher: `artifact-publisher/server/README.md` + `deployment.md` — deterministic checkout, signed proofs, multisig flows.  
* RepoWriter: `RepoWriter/README.md` — dev tool and allowlist policy. 
* Control-Panel: `control-panel/README.md` — operator UI notes. 
* SentinelNet, Memory Layer, Reasoning Graph, Agent Manager, AI Infra, Marketplace, Finance: each has its own README and acceptance criteria in the module folder. See the module root for details.  

**Common dev actions**

```bash
# Install at repo root
npm ci

# Per-module: see each README (examples)
cd agent-manager && npm ci
cd memory-layer && npm ci
cd artifact-publisher/server && npm ci

# Many modules offer run-local.sh or docker-compose for dev orchestration
# See artifact-publisher/run-local.sh and sentinelnet/run-local.sh for examples.
```

### Golden-path orchestration

Use `./scripts/run-golden-path.sh start` to boot the subset of services needed for the buyer flow smoke tests (Finance run-local mocks, Marketplace backend stack, Marketplace UI mock API, optional Control-Panel). Logs land in `/tmp/golden-path/*.log`, and the helper waits for each `/health` endpoint before returning. Stop everything with `./scripts/run-golden-path.sh teardown`.

CI mirrors the same flow via `.github/workflows/golden-path-e2e.yml`, which:

1. Boots the stack with `scripts/run-golden-path.sh`.
2. Runs Marketplace Playwright acceptance tests (OIDC mock path + signed badge check).
3. Runs Finance e2e ledger tests.
4. Generates and verifies a ledger proof (`finance/tools/ci_generate_and_verify_proof.sh`) and uploads the proof + Playwright report artifacts.

---

## Contribution & governance notes (how we stay safe)

* **Single-file, auditable authoring** — changes are made deliberately and audited. The repo’s root README documents the workflow. 
* **Allowlist for repo edits:** RepoWriter enforces `repowriter_allowlist.json`. CI should block PRs that attempt to change forbidden paths (infra, secrets, etc.). 
* **Security checklist:** RepoWriter and ArtifactPublisher include security review checklists and tests to ensure signing, secrets handling, and audit behavior are correct before production rollouts. 

---

## Where to read next (priority)

1. `docs/GOLDEN_PATH.md` — the canonical step-by-step publish & buy flow (if present).
2. `kernel/` — Kernel API & Governance (`kernel/README.md`). 
3. `IDEA/` — Creator API and signing contract (`IDEA/spec.md` and `IDEA/server/README.md`). 
4. `artifact-publisher/server/` — checkout, signed proofs, and deployment guide. 
5. `control-panel/` — operator flows and signing proxy setup. 

---

## Final practical advice

* **Treat Kernel & signing as the highest priority.** If Kernel signing or KMS is misconfigured, downstream proofs are meaningless. 
* **Run the golden path smoke test frequently.** The golden path (IDEA → Kernel → ArtifactPublisher → Marketplace → Finance) is the single most important integration to keep green. 

---
