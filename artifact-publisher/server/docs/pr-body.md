## Summary
- ArtifactPublisher server completion + deterministic checkout/proof/licensing flow.
- Kernel mock, multisig upgrade orchestration, sandbox determinism.

## Testing
- `npm test`
- `npx vitest run test/e2e/checkout.e2e.test.ts`
- `npx vitest run test/e2e/multisig-e2e.test.ts`
- `npx vitest run test/e2e/signedProofs.e2e.test.ts`
- `npx vitest run test/unit/sandboxRunner.test.ts`
- `RUN_TESTS=1 ./run-local.sh`

## Files Changed
- `artifact-publisher/server/**`
- `.github/workflows/artifact-publisher-ci.yml`
- `RepoWriter/server/index.js`

> ArtifactPublisher final acceptance: all tests passed locally and in CI. Checkout→payment→finance→license→delivery E2E verified and audit chain validated. Compatibility shim in place. Ready for Security & Finance sign-off.
