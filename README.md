# ILLUVRSE — Monorepo (Main)

This repository is the authoritative home for ILLUVRSE’s core platform modules.
Everything is organized as independent modules under `~/ILLUVRSE/Main/` and follows a strict single-file-at-a-time authoring workflow documented with per-module READMEs.

## # Purpose
This repo contains the design, specs, deployment guides, and acceptance criteria for the full ILLUVRSE platform: Kernel, Agent Manager, Memory Layer, Reasoning Graph, Eval Engine, SentinelNet, Marketplace, Finance, AI Infra, Capital, Product & Development, Market & Media, and supporting artifacts.

## # Layout (high level)

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
├─ capital/
├─ product-development/
├─ market-media/
├─ .gitignore
└─ README.md

Each module folder contains:
- `*.md` spec files (spec, deployment, README, acceptance-criteria, etc.)
- `.gitignore` where applicable
- All changes are audited and tied to Kernel manifests as the system evolves.

## # How we work (single-step, auditable)
We follow a strict workflow to keep the platform correct and auditable:
1. **One file at a time:** I give you one file and its exact content. You save it, then say **“done.”**
2. **Run & test locally:** implement and test before committing. Don’t rush across files.
3. **Commit & push:** once validated, commit module changes and push to GitHub — Vercel / infra will pick up deploys where configured.
4. **Sign-off:** modules require sign-off per `acceptance-criteria.md` before considered live. Ryan is final approver for Core modules.

## # Conventions
- API shapes: camelCase for API, snake_case for DB.
- Auth: human = OIDC/SSO; services = mTLS. SuperAdmin = **Ryan**.
- Signing: Ed25519 via KMS/HSM. No private keys committed.
- Audit: every critical action must emit AuditEvent (SHA256 + signature + prevHash).

## # Quick commands
Create a module folder and a file (example):
cd ~/ILLUVRSE/Main
mkdir -p kernel
cat > kernel/README.md <<'EOF'
## Kernel — Core Module
...
EOF

Contacts / governance

Final approver: Ryan (SuperAdmin)

Security contact: Security Engineer (assigned)

Finance contact: Finance Lead (assigned)

Codex CLI test successful.
multi-file edit successful.
