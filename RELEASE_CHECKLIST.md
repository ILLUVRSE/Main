# RELEASE_CHECKLIST

> Track launch readiness across IDEA, Marketplace, Finance, and platform services.  
> Mark items `[x]` when automated or documented steps are in place. Use `[ ]` for pending or manual follow-up.  
> For manual production data (e.g., real KMS endpoints) include the owner + due date.

## Cross-Cutting Platform
- [x] Kernel signer registry documented with `signer_kid`/`public_key_pem` format (`kernel/tools/signers.json`, `kernel/deployment.md`).
- [x] `shared/lib/audit.ts` provides canonicalization, hashing, signing adapters, and atomic audit append helper.
- [x] Signing proxy mock available at `kernel/mock/signingProxyMock.js` for local + CI use.
- [x] Startup guards (`infra/startupGuards.ts`) enforce `REQUIRE_KMS|REQUIRE_SIGNING_PROXY` + `REQUIRE_MTLS` in production.
- [x] Repo secret scanner (`scripts/ci/check-no-private-keys.sh`) fails CI on PEM/.key/.env leaks.
- [ ] Production KMS endpoints + certificates injected via secret manager (owner: Infra, due: prod cutover).

## IDEA
- [x] Local orchestration script (`IDEA/scripts/run-local.sh`) and Kernel/signing proxy mocks updated.
- [x] Backend endpoints (`/packages/*`, `/manifests/*`, `/publish/notify`) implemented with audit + KMS integration.
- [x] Multisig + publish scripts/tests (`scripts/validate_package.js`, `scripts/e2e_multisig.sh`) created.
- [x] Runbooks (`manifest_issues`, `multisig`, `publish_retries`) authored.
- [x] CI workflow (`IDEA/.github/workflows/idea-ci.yml`) running unit/contract/e2e suites.
- [x] Signoff templates (`IDEA/signoffs/security_engineer.sig`) populated with placeholders.

## Marketplace
- [x] Backend checkout + delivery endpoints wired to Finance + signed proof generation.
- [x] Sandbox runner + unit/e2e tests passing.
- [x] Next.js storefront + control-panel with OIDC/dev fallback implemented.
- [x] Docs updated (`docs/PRODUCTION.md` for Object Lock + key rotation).
- [x] Signed proof e2e + checkout acceptance tests green in CI workflow (`.github/workflows/signed-proof-e2e.yml`).
- [x] Signoff templates (security, finance lead, Ryan) committed.

## Finance
- [ ] Ledger endpoints (`/ledger/post`, `/settlement`, `/proofs/*`) enforcing double-entry invariants.
- [ ] Unit + e2e tests (`test/unit/ledger_balance`, `acceptance-tests/checkout-ledger.e2e`) cover invariants.
- [ ] Ledger proof tooling + docs (`tools/generate_ledger_proof.*`, `docs/RECONCILIATION.md`, `infra/audit_export_policy.md`).
- [ ] CI workflow ensures audit verification and signing guards.
- [ ] Signoff templates committed.

## Memory Layer / Agent Manager / SentinelNet / Reasoning Graph
- [ ] Health + readiness endpoints verified for each service.
- [ ] Audit emission via shared helper + OTEL metrics instrumented.
- [ ] SentinelNet JSONLogic evaluator + canary rollback flow with tests.
- [ ] Run-local scripts validated.

## CI / Golden Path / Runbooks
- [x] `.github/workflows/golden-path-e2e.yml` boots stack + runs IDEA/Marketplace/Finance e2e + audit verify.
- [x] `.github/workflows/signed-proof-e2e.yml` runs ArtifactPublisher signed-proof verification in CI (checkout → finance ledger proof → proof verification).
- [ ] Module CI workflows reference `scripts/ci/check-no-private-keys.sh` + `kernel/ci/require_kms_check.sh`.
- [x] SRE runbooks for signing/KMS outage and audit export failures present (`sre/runbooks/*.md`).
- [x] Documentation for manual validation commands (curl health, audit-verify, run-local) consolidated.

## Manual Follow-ups (Production Only)
- [ ] Provision production KMS keys + update `SIGNING_PROXY_URL` secrets (owner: Security Eng).
- [ ] Upload final signer public keys to `kernel/tools/signers.json` and distribute to downstream verifiers (owner: Kernel team).
- [ ] Configure mTLS CA bundles in every service deployment (owner: Infra).
- [ ] Validate S3 Object Lock retention + replication in production bucket (owner: SRE/Compliance).
