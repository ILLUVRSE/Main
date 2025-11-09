# AI & Infrastructure — Core Module

## # Purpose
AI & Infrastructure provides the model registry, training orchestration, reproducible training runs, serving stack, promotion pipelines, canaries and rollback, drift detection, and artifact governance required by the platform. All model artifacts and promotions must be traceable and signed.

## # Location
All files for AI & Infrastructure live under:
`~/ILLUVRSE/Main/ai-infra/`

## # Files in this module
- `ai-infra-spec.md` — design doc and responsibilities.  
- `README.md` — this file.  
- `deployment.md` — infra and deployment guidance (to be created).  
- `acceptance-criteria.md` — acceptance tests (already present).  
- `model-registry/` — (to be created) registry API and metadata store.

## # How to use this module
1. Read `ai-infra-spec.md` and `ai-infra/acceptance-criteria.md`. The acceptance criteria require deterministic training runs, model registry lineage, secure promotion and signing, canary + rollback strategies, drift detection, checkpointing, and compliance with SentinelNet policies.  
2. Implement pipelines that:
   * Record full provenance for training (codeRef, container digest, dependency manifest, dataset checksums, hyperparams, seed, environment).  
   * Store model artifacts in immutable storage with artifact checksum and signed manifest.  
   * Register models in the model registry with lineage, metrics, and signerId.  
   * Enforce SentinelNet gating and require ManifestSignature for promotion to staging/prod.  
   * Support canary rollouts, automatic rollback on regressions, and drift detection with retrain suggestions.

## # Security & governance
- KMS/HSM for signing and key management.  
- SentinelNet clearance required for promotions; multisig for high-risk promotions.  
- Secure handling of datasets (PII detection, legal hold) and artifact immutability.

## # Acceptance & sign-off
AI & Infra is accepted when all items in `ai-infra/acceptance-criteria.md` pass in staging: reproducible training, model registry & lineage, secure promotion and signing, serving canary/rollback, drift detection, and audit integration.

Final approver: **Ryan (SuperAdmin)**. Security Engineer and ML Lead must sign off.

## # Next single step
Create `deployment.md` that covers training cluster provisioning, model registry DB and API, artifact storage policies, and sign/verify flow with KMS/HSM. When ready, reply **“next-ai-infra”** and I’ll provide the file content.

