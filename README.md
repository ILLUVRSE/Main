# ILLUVRSE — Core Platform Monorepo

**Authoritative home for ILLUVRSE’s core platform modules.**

This repository contains the design, specifications, deployment guides, and acceptance criteria for the full ILLUVRSE platform: Kernel, Agent Manager, Memory Layer, Reasoning Graph, Eval Engine, SentinelNet, Marketplace, Finance, AI Infra, Capital, Product & Development, Market & Media, and supporting artifacts.

---

## Purpose

Maintain a single source of truth for all core platform modules and ensure workflows remain auditable, testable, and production‑ready.

---

## High-Level Layout

```text
~/ILLUVRSE/Main/
├─ kernel/
├─ agent-manager/
├─ memory-layer/
├─ reasoning-graph/
├─ eval-engine/
├─ sentinelnet/
├─ marketplace/
├─ finance/
├─ ai-infra/
├─ .gitignore
└─ README.md
```

### Module Contents

Each module folder contains:

* `*.md` specification files (spec, deployment, README, acceptance-criteria, etc.)
* `.gitignore` where applicable
* All changes must be fully auditable and tied to Kernel manifests as the system evolves.

---

## Working Rules (Single-Step, Auditable)

1. **One file at a time.** Author a single file, save it, then report "done."
2. **Run & test locally.** Implement and validate before committing.
3. **Commit & push.** After validation, commit module changes and push; CI/deploy will follow where configured.
4. **Sign-off.** Modules require sign-off according to `acceptance-criteria.md`. Ryan is the final approver for Core modules.

---

## Conventions

* **API shapes:** `camelCase`
* **Database schemas:** `snake_case`
* **Authentication:**

  * Humans: OIDC/SSO
  * Services: mTLS
  * SuperAdmin: Ryan
* **Signing:** Ed25519 via KMS/HSM; no private keys committed.
* **Audit:** Every critical action must emit an `AuditEvent` (SHA256 + signature + prevHash).

---

## Quick Commands

Create a module folder and a README example:

```bash
cd ~/ILLUVRSE/Main
mkdir -p kernel
cat > kernel/README.md <<'EOF'
## Kernel — Core Module
...
EOF
```

---

## Contacts / Governance

* **Final approver:** Ryan (SuperAdmin)
* **Security contact:** Security Engineer (assigned)
* **Finance contact:** Finance Lead (assigned)

**README maintained by:** Platform Core Team — updates by PR only.

---

## How to Apply This Change

### Option A — Git (Recommended)

Run these commands locally (replace `main` with your default branch if different):

```bash
git clone git@github.com:ILLUVRSE/Main.git
cd Main
cp README.md README.md.bak
cat > README.md <<'EOF'
<Paste the README content above in place of this line>
EOF
git add README.md
git commit -m "docs: update root README for clarity and contribution workflow"
git push origin main
```

Then open a PR from `main` (or from a branch) and request sign‑off.

### Option B — GitHub Web UI

1. Open the repository on GitHub.
2. Select `README.md`.
3. Click the pencil icon to edit the file.
4. Replace the contents with the new README.
5. Commit directly to `main` or create a branch and open a PR.
