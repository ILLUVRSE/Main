## ArtifactPublisher Final Acceptance Checklist

- [x] Service renamed from RepoWriter → ArtifactPublisher with env var fallbacks.
- [x] Compatibility shim under `RepoWriter/server/index.js`.
- [x] Kernel mock with audit + multisig endpoints.
- [x] Deterministic checkout → payment → finance → proof → license → delivery E2E suite.
- [x] Multisig upgrade E2E using Kernel mock.
- [x] Signed proof generation & verification test.
- [x] Deterministic sandbox runner unit test.
- [x] `run-local.sh` orchestration script (Postgres, kernel mock, migrations, server, optional tests via `RUN_TESTS=1`).
- [x] GitHub Actions workflow `.github/workflows/artifact-publisher-ci.yml`.
- [x] `deployment.md` capturing topology, KMS, SLOs, canary & multisig runbooks.
- [x] Updated docs/README + PR body template with test summary section.
- [x] All Vitest suites pass locally and via CI.
