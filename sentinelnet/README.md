# SentinelNet (dev)

SentinelNet is the low-latency policy engine for ILLUVRSE. This repository contains a lightweight TypeScript/Express service intended for local development and initial integration with the Kernel.

This README describes how to run SentinelNet locally, run migrations, and quickly validate integration with Kernel's mock sentinel.

---

## Quick start (local dev)

> Requirements: `node >= 18`, `npm`, `docker`, and curl.

1. **Install dependencies**

```bash
cd sentinelnet
npm ci
```

2. **Create a `.env` for local development** (example below). At minimum set `DEV_SKIP_MTLS=true` to disable mTLS locally.

```env
# sentinelnet/.env
NODE_ENV=development
SENTINEL_PORT=7602
DEV_SKIP_MTLS=true
SENTINEL_DB_URL=postgres://postgres:password@localhost:5432/sentinel_db
KERNEL_AUDIT_URL=http://127.0.0.1:7802
SENTINEL_ENABLE_AUDIT_CONSUMER=false
```

3. **Run the full verification suite locally**

```bash
./run-local.sh
```

The script installs deps (if needed), runs migrations, boots a Kernel mock with audit + multisig endpoints, and executes `npm test`. Kernel mock logs are written to `sentinelnet/kernel-mock.log`.

4. **Start the dev server**

```bash
npm run dev
```

5. **Test health + metrics**

```bash
curl http://localhost:7602/health
curl http://localhost:7602/ready
curl http://localhost:7602/metrics
```

---

## Useful endpoints

* `GET /health` — service health + transport summary (`kernelConfigured`, mTLS status)
* `GET /ready` — readiness (DB ping + Kernel probe + transport info)
* `GET /metrics` — Prometheus metrics (`sentinel_check_latency_seconds`, `sentinel_decisions_total`, `sentinel_canary_percent`)
* `POST /sentinelnet/check` — synchronous policy check (deterministic canary enforcement)
* `POST /sentinelnet/policy` — create a policy or a new version
  * Body supports `versionFromId` to bump versions, `simulate=true`, `sampleSize`, and inline `sampleEvents`.
* `GET /sentinelnet/policy/:id` — fetch a policy row
* `GET /sentinelnet/policy/:id/explain` — policy description, history, and recent decisions

See `sentinelnet/sentinelnet-spec.md` for detailed API expectations.

---

## Local testing & Kernel integration

* **Kernel mock**: `npm run kernel:mock` or `./run-local.sh` spins up a lightweight mock that implements `/kernel/audit` + `/kernel/upgrade` endpoints so audit emission, simulations, and multisig gating can be tested offline.
* **Synchronous checks**: `npm test -- check.test.ts` exercises the router. `npm test -- checkLatency.test.ts` runs the lightweight load harness that reports local p95 latency (dev goal `< 200ms`). Production SLO remains `p95 < 50ms` and is tracked via `/metrics`.
* **Audit consumer**: set `SENTINEL_ENABLE_AUDIT_CONSUMER=true` (and `KERNEL_AUDIT_URL`) to start the polling consumer that evaluates audit events asynchronously and emits `policy.decision` events back to Kernel.
* **mTLS**: production requires mTLS (`DEV_SKIP_MTLS=false` + client cert/key paths). Local dev can skip via `DEV_SKIP_MTLS=true`; readiness/health will surface whether certs are configured.

---

## Development notes

* **Evaluator**: JSONLogic (`json-logic-js`). Policies specify JSONLogic expressions in `rule`.
* **Canary**: `policy.metadata.canaryPercent` or `canary_percent` controls deterministic sampling keyed by `requestId`. Use `canary.startCanary`/`stopCanary` helpers to manage rollout and metrics (`sentinel_canary_percent` gauge).
* **Multisig gating**: High severity (`HIGH|CRITICAL`) activation requires Kernel multisig:
  1. Run simulation (`simulate=true`) and optional canary rollout.
  2. Call `multisigGating.createPolicyActivationUpgrade` to create a `policy_activation` manifest.
  3. Collect approvals via `submitUpgradeApproval` (3-of-5) and call `applyUpgrade`.
  4. Once Kernel marks upgrade `applied`, set policy state to `active`.
  See `src/services/multisigGating.ts` and the runbook below.
* **Async detection**: `src/event/consumer.ts` polls `/kernel/audit/search` and hands events to `event/handler.ts`, which re-runs evaluation and appends `policy.decision`.
* **Transport security & RBAC**: Production requires mTLS between Kernel ↔ SentinelNet (`DEV_SKIP_MTLS=false`) and RBAC fronting this service (CommandPad or API gateway). In dev we default to `DEV_SKIP_MTLS=true` and treat all callers as `principal.id=unknown`.

---

## Useful commands

* `npm run dev` — run in development (ts-node-dev)
* `npm run build` — compile to `dist/`
* `npm start` — run compiled `dist/server.js`
* `npm run migrate` — run DB migrations (reads `sentinelnet/sql/migrations`)
* `npm run kernel:mock` — start the local Kernel mock (audit + multisig endpoints)
* `./run-local.sh` — orchestrate Postgres, Kernel mock, migrations, and the full Jest suite
* `npm test -- checkLatency.test.ts` — run the dev load harness to record p95 latency

---

## Multisig activation runbook (ops)

1. Draft a policy via `POST /sentinelnet/policy`.
2. Run simulation (`simulate=true` plus optional `sampleEvents`) and review impact report.
3. Start a canary rollout by setting metadata `canaryPercent` (use `canary.startCanary` helper) and monitor `/metrics` for false positives.
4. When ready to activate a `HIGH` or `CRITICAL` policy:
   - Build a manifest (`target.policyId`, `version`, rationale, rollback plan) and call `multisigGating.createPolicyActivationUpgrade`.
   - Share the upgrade id with signers; collect >=3 approvals via `submitUpgradeApproval`.
   - Call `multisigGating.applyUpgrade` once quorum is met. Kernel mock (or prod Kernel) will mark it applied.
5. Move the policy to `active` (`policyStore.setPolicyState`) and continue monitoring.

## Next steps & TODOs

* Wire a production-grade Kafka consumer for `audit-events`.
* Replace JSONLogic with CEL if advanced expression needs arise.
* Implement RBAC middleware for policy mutation endpoints.
* Implement automated canary rollback heuristics and dashboards.

---
