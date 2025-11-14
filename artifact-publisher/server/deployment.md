# Deployment Guide

## Topology
- **ArtifactPublisher API** (`artifact-publisher/server`): stateless Node.js service exposing checkout, proof, sandbox, and multisig endpoints.
- **Kernel Mock / Kernel Service**: provides audit log + multisig upgrade APIs. In production replace with upstream Kernel service.
- **Postgres**: persists order payloads (currently ensured via `scripts/runMigrations.js`).
- **Finance + Stripe mocks**: embedded deterministic mocks (replace with real connectors when available).

All inbound traffic terminates at the API. Outbound calls are limited to the Kernel service and the configured database.

## KMS & Secrets
- **Proof signing secret**: `ARTIFACT_PUBLISHER_PROOF_SECRET` (fallback `REPOWRITER_PROOF_SECRET`). Store in KMS and inject via runtime secret manager.
- **Delivery key**: `ARTIFACT_PUBLISHER_DELIVERY_KEY` (fallback legacy var). Used to derive encrypted delivery payloads.
- **Stripe publishable key / Finance ledger id**: configurable for production processors.
- Rotate secrets via multisig change control; use Kernel audit to record rotation.

## SLOs
- **Availability**: 99.5% monthly for checkout API.
- **Latency**: P95 checkout latency ≤ 750 ms with mocks, 1.2 s when real finance services are enabled.
- **Audit freshness**: audit entries must land in Kernel within 3 s of checkout completion.
- **Proof determinism**: deterministic proof fingerprint verified by CI.

## Deployment Steps
1. `npm run build` and publish artifacts.
2. Run `npm run migrate` against the target Postgres cluster.
3. Deploy container/VM with env vars + secrets.
4. Run smoketest: `npx vitest run test/e2e/checkout.e2e.test.ts` pointing at the deployed endpoint (`API_BASE_URL` override).

## Canary Runbook
1. Deploy to a single canary instance.
2. Execute run-local-orchestrated checkout against canary with `RUN_TESTS=1 API_BASE_URL=https://canary/...`.
3. Monitor Kernel audit search for canary order IDs.
4. Promote to the remainder of the fleet after two healthy checkouts.

## Multisig Upgrade Runbook
1. Craft upgrade payload (version, binary hash, release notes).
2. Submit via `/api/multisig/upgrade` with staged approver list.
3. Collect approvals (minimum threshold = 2). Kernel mock enforces sequential approvals.
4. Kernel `apply` response returns `appliedAt` timestamp – archive in change ticket.
5. Announce upgrade completion to Security + Finance approvers.
