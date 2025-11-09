# AI & Infrastructure — Acceptance Criteria

Ensure reproducible training, secure promotion, registry lineage, and serving.

## # 1) Reproducibility
- Deterministic small training runs with reproducible artifact checksums.

## # 2) Model registry & lineage
- Model metadata includes artifactId, codeRef, datasetRefs and signerId.

## # 3) Promotion & signing
- Promotion gated by evaluation and SentinelNet; ManifestSignature required.

## # 4) Canary & rollback
- Canary rollouts with automated rollback on injected regressions.

## # 5) Drift detection
- Drift pipeline triggers retrain suggestion.

## # Test
- Train→register→promote→canary→rollback flow tested in staging.

