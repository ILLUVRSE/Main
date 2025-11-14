# ArtifactPublisher Server

ArtifactPublisher succeeds the original RepoWriter service and owns the secure delivery pipeline for digital artifacts. It provides deterministic checkout → payment → finance ledgering → signed proofs → license issuance → encrypted delivery as well as multisig upgrade orchestration through the Kernel mock.

## Getting Started

```bash
cd artifact-publisher/server
npm install
npm run build
npm test
```

Environment variables fall back to their legacy `REPOWRITER_*` counterparts and default to local-friendly values. Key options:

- `ARTIFACT_PUBLISHER_PORT` (default `6137`)
- `ARTIFACT_PUBLISHER_KERNEL_URL` (default `http://127.0.0.1:6050`)
- `ARTIFACT_PUBLISHER_DB_URL` or `REPOWRITER_DB_URL`

## Local Orchestration

`run-local.sh` provisions Postgres via `docker compose` (optional when Docker is unavailable), runs lightweight migrations, launches the Kernel mock (`mock/kernelMockServer.js`), builds the server, and starts it. Set `RUN_TESTS=1` to execute the full E2E suite and `KEEP_ALIVE=1` to keep services running after validation. In sandboxes where binding to TCP ports is disallowed, export `HEADLESS_MODE=1` (or `ARTIFACT_PUBLISHER_DISABLE_LISTENER=1`) before invoking the script to skip the listener while still running migrations and tests.

## Tests

- `npm test` – full Vitest suite (unit + e2e).
- `npx vitest run test/e2e/checkout.e2e.test.ts` – deterministic checkout flow.
- `npx vitest run test/e2e/multisig-e2e.test.ts` – Kernel multisig upgrade path.
- `npx vitest run test/e2e/signedProofs.e2e.test.ts` – signed proofs + audit verification.
- `npx vitest run test/unit/sandboxRunner.test.ts` – sandbox determinism.

## Runbooks

Refer to `deployment.md` for topology, KMS responsibilities, SLOs, canary steps, and multisig upgrade procedures. The PR body template (`docs/pr-body.md`) captures the final acceptance sign-off statement.
