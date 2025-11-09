# AI & Infrastructure — Deployment

## Components
- Training cluster (K8s + GPU nodes), scheduling (KubeBatch, Argo), artifact storage S3, model registry Postgres.

## Storage & provenance
- Artifact immutability in S3, model registry DB backups.

## Security
- KMS/HSM signing proxy for model manifests, SentinelNet gating for promotions.

## Observability
- Metrics: training duration, GPU hours, drift metrics.

