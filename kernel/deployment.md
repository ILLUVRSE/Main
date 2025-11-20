# Kernel — Deployment & Infrastructure Guide

Purpose
-------
Practical, production-ready instructions to deploy the Kernel (API + governance + signing + audit). This focuses on secure, auditable, high-availability deployment patterns, KMS/HSM integration, audit pipeline, and operational runbooks required for sign-off.

1) High-level architecture
--------------------------
- **Kernel API** (stateless): validates requests, enforces RBAC, coordinates multisig/upgrade flows, and orchestrates signing and audit writes.
- **Signing Proxy / KMS/HSM**: HSM-backed signing for manifests and audit events (Ed25519). Kernel delegates signing to the KMS via a signing proxy or mTLS-authenticated API.
- **Audit pipeline**: single-writer audit topic (Kafka/Redpanda) → durable sink (S3 with object-lock) + Postgres index for queries.
- **Key Registry & Truststore**: public keys exposed via trusted endpoint for verifiers/auditors.
- **Auxiliary stores**: Postgres (authoritative metadata, indices), object storage (archives, snapshots), and optionally a small key-value cache for recent head hash.

Diagram:
 Kernel (mTLS) → API pods → Signing Proxy → KMS/HSM
               → Audit producer (Kafka) → Indexer → Postgres / S3

2) Required infra & providers
-----------------------------
- Kubernetes (EKS/GKE/AKS) for Kernel API and CI/CD runners.
- Managed Postgres for auth/state and indexing.
- Kafka/Redpanda for ordered audit stream.
- S3 (or compatible) with versioning + object-lock for audit archive.
- KMS/HSM (cloud or on-prem HSM) supporting Ed25519 or a signing proxy to translate requests.
- Vault or equivalent for runtime secrets (DB, KMS creds).
- Prometheus/Grafana + OpenTelemetry for metrics/tracing.
- GitOps / ArgoCD or Helm for deployments.

3) Kubernetes deployment patterns
---------------------------------
- Namespace: `illuvrse-kernel-<env>`.
- Helm chart: Deployment (api), ConfigMaps, Secrets (populated from Vault), Service, HPA, PodDisruptionBudget, NetworkPolicy.
- Minimum replicas: 3 API replicas in prod behind LB for availability.
- Use leader election for single-writer tasks (head-hash append helper, upgrade apply coordinator).
- Liveness/readiness probes: check Postgres, signing proxy, and Kafka connectivity.
- `deploy/k8s/kernel-deployment.yaml` provides the baseline Deployment/Service manifest with `/ready` and `/health` HTTP probes wired to the new readiness logic (DB + KMS checks).

4) Signing & KMS integration
----------------------------
- **Production signing must use KMS/HSM** (no local keys). Configure `KMS_ENDPOINT`, `SIGNER_ID`.
- Kernel should call a signing proxy or KMS over mTLS; CI must enforce `REQUIRE_KMS=true` for protected branches.
- Signing flow must be atomic with audit append: compute canonical payload → compute hash → request signature → append event to audit topic and durable sink.
- Public keys and signer metadata must be published at `/kernel/security/status` or Key Registry.
- Signer registry format (`kernel/tools/signers.json`):
  ```json
  {
    "signers": [
      {
        "signer_kid": "kernel-audit-ed25519-v1",
        "algorithm": "ed25519",
        "public_key_pem": "-----BEGIN PUBLIC KEY-----...-----END PUBLIC KEY-----",
        "deployedAt": "2025-02-24T00:00:00Z",
        "description": "Primary staging signer"
      }
    ]
  }
  ```
  Update this file via `scripts/update-signers-from-kms.sh` and re-run `node kernel/tools/audit-verify.js --signers kernel/tools/signers.json` after every rotation.

5) Audit pipeline & storage
---------------------------
- Single-writer partitioning guarantees `prevHash` ordering per shard. Prefer a single logical writer for the primary audit sequence, or sharded partitions with well-defined shard keys.
- Kernel writes to Kafka `audit-events`. An indexer consumes and writes index rows to Postgres and archives canonical JSON to S3 `audit/YYYY/MM/DD/<id>.json`.
- Archive must be immutable (object-lock / WORM) for legal retention.
- Implement nightly chain verification and a verification tool that replays S3 archive to confirm hash+signature chain.

6) Networking, auth & RBAC
--------------------------
- **Service auth**: mTLS mandatory for service-to-service calls. Map CN to role via middleware.
- **Human auth**: OIDC/SSO for UI flows. Role map: SuperAdmin, DivisionLead, Operator, Auditor.
- **NetworkPolicy**: deny-all default; allow only required egress to Postgres, Kafka, Signing Proxy, Vault, S3.

7) Secrets & config
-------------------
- Use Vault or cloud secret manager via CSI driver for cluster secrets.
- No private keys or plaintext secrets in repo or images. Audit CI/CD secrets usage and enforce secrets scanning.
- Mount or bake the OpenAPI spec and set `OPENAPI_PATH` (image defaults to `/app/openapi.yaml`); the entrypoint and server fail fast in production if the spec or validator is missing.

8) Backups, DR & replay
-----------------------
- Postgres: PITR + daily snapshots. Test restore monthly.
- S3 audit archive: versioning + replication (cross-region). Retain per policy (e.g., 7 years).
- Provide a documented procedure to rebuild indices and replay audit archives; include a “safe-mode” where signing requests are rejected while rebuilding.

9) Observability & SLOs
-----------------------
- Metrics: request rates, p95/p99 latency for sign and core endpoints, audit append latency, head-hash compute latency, signature/sec.
- Tracing: instrument sign, canonicalize, hash, append flows.
- SLO examples: core read p95 < 200ms; sign operation p95 < 200ms; audit append p95 < 500ms.
- Alerts: KMS errors, audit append failures, signature mismatches, DB replication lag.

10) CI/CD & release strategy
----------------------------
- CI: lint, unit tests, contract tests (OpenAPI validation), security scans (SAST), run signing/verification tests using a staging signing proxy emulating KMS.
- CD: build images → push → deploy to staging → run acceptance tests (contract + audit chain verification) → canary → production.
- Protect main branches with `REQUIRE_KMS=true` and CI gate checking `kernel/ci/require_kms_check.sh` behaviour.

11) Testing & validation
------------------------
- Unit tests: canonicalization, hash calculation, signature verification, multisig logic.
- Integration tests: create manifest → sign → append audit → verify chain; multisig upgrade flow (3-of-5).
- End-to-end: spawn agent → sign manifest → audit chain verification across services.

12) Runbooks (must exist)
-------------------------
- KMS/HSM unavailable — failover to read-only mode; emergency key usage; how to test.
- Audit append failures — diagnose Kafka, indexer, or S3 write errors; steps to resume and replay.
- Key compromise — emergency rotation, revocation, and audit response.
- Restore drill — full Postgres + archive restore steps and verification.
- Multisig failure & manual ratification.

13) Acceptance criteria (deployment)
------------------------------------
- Kernel deployed to staging: `/health` and `/ready` OK; sign endpoint integrated with staging KMS and returns valid signature.
- Audit pipeline: Kafka → Postgres index → S3 archive functioning; chain verification tool passes on sample dataset.
- KMS/HSM integration: signatures verifiable with public key from Key Registry; no private keys in cluster.
- RBAC/mTLS enforced for all critical endpoints; OIDC for UI.
- CI gates enabled: tests, security scans, and `REQUIRE_KMS` enforced for protected branches.
- Runbooks and operational checks documented and accessible.

End of file.
