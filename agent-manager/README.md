# Agent Manager — Core Module

## Purpose
Agent Manager is the operational runtime for ILLUVRSE agents. It provides:
- Template storage & versioning for agent blueprints.
- Spawn / register agents from templates or Kernel-signed manifests.
- Lifecycle control: start / stop / restart / scale / unregister.
- Health, logs, telemetry and sandbox test execution.
- Append-only audit events and Event Bus publishing for all critical actions.
- Security: verify Kernel signatures for production (`illuvrse` profile), enforce RBAC, and use KMS for signing events.

This module is intentionally minimal and testable: prove spawn → manage → observe → audit before expanding features.

## Files in this module (high level)
- `README.md` — this file
- `acceptance-criteria.md` — tests & sign-off checklist
- `openapi.yaml` — API contract (OpenAPI v3)
- `package.json` — npm workspace manifest
- `.gitignore` — ignore runtime artifacts and secrets
- `server/` — server code (routes, middleware, utils)
  - `server/index.js` — Express entrypoint
  - `server/routes/*.js` — route handlers
  - `server/middleware/*.js` — auth, signature verification, audit hooks
  - `server/utils/*.js` — kms, eventbus, telemetry
- `db/` — migrations and seeds
- `sandbox/` — sandbox runner image and worker
- `docker-compose.yml` — local dev composition (postgres, redis, eventbus, minio)
- `Dockerfile` — module image
- `scripts/` — setup, migrations, local start helpers
- `test/` — unit, integration and smoke tests
- `docs/` — deployment and security docs

---

## Quickstart — local dev (dev-focused, reproducible)
These steps assume you saved the full module and have node/npm or pnpm installed.

1. Install deps:
```bash
cd ~/ILLUVRSE/Main/agent-manager
npm ci

Run DB & infra via docker-compose (created later):
docker-compose up -d
# wait for Postgres, Redis, Minio

Run migrations & seed templates (scripts to be added):
scripts/run_migrations.sh
scripts/seed_templates.sh

Start local server:
npm start
# server listens on http://127.0.0.1:5176 by default

Smoke test spawn:
curl -s -X POST http://127.0.0.1:5176/api/v1/agent/spawn \
  -H 'Content-Type: application/json' \
  -d '{"agent_config":{"name":"demo","profile":"personal","metadata":{"owner":"ryan"}}}'

Expected: 201 with { ok: true, agent_id: "...", status: "initializing" }

Acceptance criteria (MVP)

Agent Manager is MVP-complete when these are true and verifiable:

Spawn: POST /api/v1/agent/spawn creates an agent record and returns an agent_id.

Manifest enforcement: if agent_config.profile === 'illuvrse', then signed_manifest is required; invalid signatures are rejected with 403.

Lifecycle: POST /api/v1/agent/{id}/action supports start|stop|restart|scale and updates agent status.

Sandbox: POST /api/v1/agent/{id}/sandbox/run queues a run and returns run_id; run completes passed|failed.

Audit: every write operation creates an entry in audit_events (append-only).

Telemetry: metrics emitted: agent_manager.agent.spawn.duration, agent_manager.agent.uptime, sandbox.run.duration, sandbox.run.success_rate.

Tests: unit tests cover core logic; integration tests exercise spawn + signature verification + sandbox smoke run. CI runs these tests.

Security review: Security Engineer has reviewed KMS/signing and multisig rules where applicable.

Signed audit events and signature verification must be implemented before production illuvrse manifests are accepted.

Next single action (what I will create next)

server/index.js — minimal Express scaffold with routes:

POST /api/v1/agent/spawn

GET /api/v1/agent/:id/status

POST /api/v1/agent/:id/action

GET/POST /api/v1/agent/templates

This file will implement an in-memory MVP (Map-backed) so we can run and verify locally before adding persistence and KMS.

Governance & ownership

Final approver: Ryan (SuperAdmin)

Required reviewer: Security Engineer (for KMS/HSM and signature rules)

All critical actions must emit AuditEvent (SHA256 + signature + prevHash) per repo governance.

Notes

Design for idempotency: write endpoints accept Idempotency-Key for safe retries.

Keep the API small and testable; iterate on clear acceptance criteria.

Don’t store private keys in repo. Use env-based KMS configuration in config/*.json.
