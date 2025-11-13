# SentinelNet (dev)

SentinelNet is the low-latency policy engine for ILLUVRSE. This repository contains a lightweight TypeScript/Express service intended for local development and initial integration with the Kernel.

This README describes how to run SentinelNet locally, run migrations, and quickly validate integration with Kernel's mock sentinel.

---

## Quick start (local dev)

> These steps assume you have `node >= 18`, `npm`, and Docker available.

1. **Install dependencies**

```bash
cd sentinelnet
npm ci
```

2. **Create a `.env` for local development** (example below). At minimum you should set `DEV_SKIP_MTLS=true` to avoid mTLS setup for iteration.

```env
# sentinelnet/.env
NODE_ENV=development
SENTINEL_PORT=7602
DEV_SKIP_MTLS=true
SENTINEL_DB_URL=postgres://postgres:password@localhost:5432/sentinel_db
KERNEL_AUDIT_URL=http://127.0.0.1:7602  # optional for local testing with mock kernel
```

3. **Run a local Postgres** (quick docker compose)

```bash
docker run --name sentinel-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=sentinel_db -p 5432:5432 -d postgres:15
```

4. **Apply DB migrations**

```bash
npm run migrate
```

5. **Start the service in dev mode**

```bash
npm run dev
```

6. **Test the health endpoint**

```bash
curl http://localhost:7602/health
```

---

## Useful endpoints

* `GET /health` — basic health
* `GET /ready` — readiness (DB + kernel probe)
* `POST /sentinelnet/check` — synchronous policy check
* `POST /sentinelnet/policy` — create a policy (supports `simulate` flag)
* `GET /sentinelnet/policy/:id/explain` — explain a policy
* `GET /metrics` — Prometheus metrics (if enabled)

See `sentinelnet/sentinelnet-spec.md` for detailed API expectations.

---

## Local testing & Kernel integration

The repo includes test harness files and a mock sentinel server under Kernel tests. To integrate with Kernel locally:

* Run Kernel's mock sentinel server (or the mock server shipped in the Kernel tests). Kernel's mock sentinel listens by default on port `7602` in the test config — confirm ports and env.
* Configure `KERNEL_AUDIT_URL` to point to your local Kernel (or mock) for features that call Kernel (audit append / search). If you don't have Kernel running, the service will still function for policy CRUD and local evaluation — audit writes will be no-ops.

---

## Development notes

* **Evaluator**: The first iteration uses JSONLogic (`json-logic-js`). Policy `rule` fields should contain JSONLogic expressions. The evaluator facade allows replacement with CEL or other engines later.
* **Audit events**: Audit events are posted to Kernel's `/kernel/audit` endpoint. For dev iteration you can set `DEV_SKIP_MTLS=true` and point `KERNEL_AUDIT_URL` to a local Kernel mock.
* **Canary & Multisig**:

  * Policy metadata may include `canaryPercent` (0-100) to enable sampling for canary policies.
  * High-severity policy activation can be gated by Kernel's multisig flow. See `src/services/multisigGating.ts`.
* **Event consumer**: A polling-based consumer (`src/event/consumer.ts`) is provided as a first-cut for asynchronous detection; switch to Kafka/Redpanda consumer for production.

---

## Useful commands

* `npm run dev` — run in development (ts-node-dev)
* `npm run build` — compile to `dist/`
* `npm start` — run compiled `dist/server.js`
* `npm run migrate` — run DB migrations (reads `sentinelnet/sql/migrations`)

---

## Next steps & TODOs

* Wire a production-grade Kafka consumer for `audit-events`.
* Replace JSONLogic with CEL if advanced expression needs arise.
* Implement multisig UI/hooks in CommandPad to collect signatures for high-severity policy activations.
* Implement policy lifecycle automation (canary rollout monitoring, auto-rollback).

---

