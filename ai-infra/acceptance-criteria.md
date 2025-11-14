# AI & Infrastructure — Acceptance Criteria

Ensure reproducible training, secure promotion, registry lineage, and serving.

## # 1) Reproducibility
- Deterministic small training runs with reproducible artifact checksums.

## # 2) Model registry & lineage
- Model metadata includes artifactId, codeRef, datasetRefs and signerId.
- Registry stores signer signature + optional manifestSignatureId per artifact registration.
- `go test ./ai-infra/internal/acceptance -run Promotion` verifies registration stores signature + provenance.

## # 3) Promotion & signing
- Promotion gated by evaluation and SentinelNet; ManifestSignature required.
- Promotion records persist SentinelNet decisions and promotion signatures (hash of artifactId+environment+eval).

## # 4) Canary & rollback
- Canary rollouts with automated rollback on injected regressions.

## # 5) Drift detection
- Drift pipeline triggers retrain suggestion.

## # Test
- Train→register→promote→canary→rollback flow tested in staging.
