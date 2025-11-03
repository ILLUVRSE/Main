# Agent Manager — Deployment & Infrastructure Guide

Purpose: practical, operational instructions for deploying the Agent Manager as a production-grade service. This doc describes the recommended infra components, Kubernetes patterns, security posture, CI/CD, scaling, observability, backups, and recovery. Keep this as the single source of truth for deployments.

---

## # 1) High-level deployment architecture
- Deploy Agent Manager as a Kubernetes-native service (K8s cluster per region or environment).
- Provide a Helm chart (or Kustomize) for deploying the service, CRDs (if any), RBAC, and defaults.
- Use a dedicated namespace: `illuvrse-agent-manager` (or shard by division/region).
- Use a managed Postgres for authoritative state, Kafka/Redpanda for audit/event streaming, and S3-compatible object store (or cloud blob) for artifacts and long-term audit archives.
- Use Vault (or cloud secret manager) for secrets and cert issuance. Integrate with your internal PKI for mTLS certs.

---

## # 2) Infra components required
- **Kubernetes cluster** (K8s >= 1.24 recommended). Multi-AZ for resiliency.
- **Postgres** (managed RDS/AzureDB/GCP Cloud SQL) with replica for HA.
- **Kafka / Redpanda** for audit/events (single logical cluster with topic `audit-events`). Consider managed Redpanda / Confluent.
- **Vector DB** (if Agent Manager needs it; otherwise AI infra provides it).
- **Object storage** (S3 / MinIO) for artifacts, audit archives. Enable immutable object locking for audit buckets.
- **Vault / Secrets Manager** for secrets and dynamic credentials (DB creds, signing proxy tokens).
- **Ingress / Service Mesh**: optional (Istio/Linkerd) for mTLS, observability, and routing. If not using a mesh, ensure mTLS at the application layer.
- **Prometheus + Alertmanager + Grafana** for metrics and alerting.
- **Logging stack**: ELK or hosted log service (store logs centrally, retain per retention policy).
- **CI/CD**: GitHub Actions / GitLab CI / Tekton to build images, run tests, and publish artifacts.
- **Runner/Node pools**: GPU node pools for AI infra; agent manager nodes should be CPU-optimized with high I/O if running many containers.

---

## # 3) Kubernetes deployment patterns
- **Helm chart**: package deployment, service, deployment, HPA, ConfigMap, SecretTemplate, ServiceAccount, RBAC, and PodDisruptionBudget. Provide a `values.yaml` for environment overrides.
- **Replica set & HPA**: default replicas 2; HPA based on CPU/memory and custom metrics (queue depth, provisioning latency).
- **PodDisruptionBudget**: allow controlled eviction; keep `minAvailable: 1` or `50%` depending on SLA.
- **Stateful vs stateless**: Agent Manager itself should be stateless horizontally (store state in Postgres). Use leader-election (e.g., via a Lease object) for single-writer operations if needed.
- **Leader election**: required for provisioning coordination to prevent races (use Kubernetes Lease API).
- **Init containers**: for migrations (DB migration job runs as init or separate helm hook). Use `kubectl rollout` style flows for safe upgrades.
- **Start-up checks**: liveness/readiness probes configured to check DB and Kafka connectivity.

---

## # 4) Networking & security
- **mTLS**: all inbound calls from Kernel must use mTLS. Issue service certs from Vault PKI or in-cluster CA. Validate client certs and map CN to service identity.
- **Network policies**: strict K8s NetworkPolicies limiting egress only to required services (Postgres, Kafka, Vault, S3, AI infra). Deny-all default.
- **Egress controls**: block internet egress unless required. Any egress must be approved and audited.
- **Authorization**: service accounts in K8s map to Kernel roles. Use short-lived tokens for non-service identities.
- **Pod security**: run as non-root, drop capabilities, restrict hostPath mounts. Use PSP or Pod Security admission to enforce.
- **Secrets**: mount secrets from Vault via CSI driver or use in-memory injection. Do not store secrets in environment variables unless ephemeral.

---

## # 5) Databases & durable storage
- **Postgres**: run as managed service. Use connection pooling (PgBouncer) and prepared statements. Run migrations via CI job or helm hook. Backups daily, WAL archiving for point-in-time recovery.
- **Kafka/Redpanda**: configure topic `audit-events` with replication factor >=3. Single-writer per partition; ensure partitioning strategy for ordering guarantees.
- **S3**: enable object lock and versioning for audit archives. Archive audit topics daily to S3 as a compressed file.
- **Indexing**: materialize a query index in Postgres for audit metadata; store raw canonical payloads in S3.

---

## # 6) CI/CD & release strategy
- **Repo structure**: `/agent-manager` contains helm chart under `/charts/agent-manager` and Dockerfile under `/images/agent-manager`.
- **Pipeline stages**:
  1. Lint + unit tests.
  2. Build Docker image, scan (Snyk/Trivy), push to registry.
  3. Integration tests in ephemeral cluster (use kind / ephemeral env or dedicated staging).
  4. Publish Helm chart to registry.
  5. Deploy to `staging` via GitOps (ArgoCD/Flux) or CI deploy step; run acceptance tests.
  6. Promote to `canary` in production (1-2 pods), run canary checks, then full rollout.
- **Multi-sig deploy gating**: Kernel-level or infra-level changes requiring multi-sig (see multisig workflow) must be enforced in CI for protected branches/releases.
- **Rollback**: support automatic rollback on canary failure or manual rollback via Helm/ArgoCD. Keep previous image/tag for quick revert.

---

## # 7) Migrations & upgrades
- Run DB migrations as a pre-deploy job (helm hook/job) with a migration script. Keep migrations backward-compatible where possible.
- For breaking schema changes, use blue/green or expand-contract migration steps: add new columns, backfill, switch consumers, then drop old columns. Document each breaking change in the upgrade manifest.

---

## # 8) Observability & SLOs
- **Metrics**: instrument endpoints and internals: request latency, request rate, sign operations/sec, provisioning latency, active agents, failed starts, heartbeats missing. Export via Prometheus metrics.
- **Tracing**: use OpenTelemetry or Jaeger to trace provisioning flows end-to-end. Propagate trace IDs through Agent Manager → Kernel → Resource Allocator.
- **Logs**: structured JSON logs with `agentId`, `requestId`, `traceId`. Ship logs to ELK or hosted logs.
- **Dashboards & alerts**: Grafana dashboards for provisioning latency, active agent counts, heartbeats. Alerts for:
  - high provisioning failure rate,
  - missed heartbeats > threshold,
  - key rotation failures,
  - audit pipeline lag (Kafka consumer lag),
  - DB connection saturation.
- **SLO examples**: p95 read latency < 200ms, provisioning median < X seconds (define X based on environment), audit event ingest < 1s.

---

## # 9) Scaling & capacity planning
- **Horizontal scaling**: scale Agent Manager pods; leader-election for single-writer actions.
- **Sharding**: consider sharding by division or region for very large fleets.
- **Resource nodes**: use node pools for different workloads — dedicated nodes for provisioning heavy tasks.
- **GPU scheduling**: Agent Manager should prefer GPU node pools when requesting GPUs via Resource Allocator; avoid running GPU workloads on control-plane nodes.
- **Autoscaling**: enable cluster autoscaler for node pools, HPA for pods, and scale Kafka/DB separately.

---

## # 10) Backups & recovery
- **Postgres**: point-in-time recovery via WAL, daily snapshots. Store backups in a different region.
- **Kafka**: mirror topics to backup cluster or use tiered storage. Archive audit topic to S3 daily.
- **S3**: object lock + versioning for immutable storage.
- **Recovery drills**: run quarterly DR drills to restore Postgres and replay audit events from S3 into a rebuild cluster.

---

## # 11) Disaster recovery & failover
- **Single-region outage**: have cross-region replicas for Postgres and Kafka if required by RPO/RTO. Document failover steps and automation.
- **Operational safe mode**: support a “safe mode” where signing and apply operations are suspended and only read operations allowed while integrity rebuilds occur.
- **Key compromise**: documented in `security-governance.md` — revoke keys, rotate, run verification, and replay.

---

## # 12) Testing & validation
- **Unit & integration tests**: run in CI.
- **End-to-end**: ephemeral cluster runs that simulate instantiate → provision → run → destroy.
- **Chaos testing**: simulate node kill, DB failover, Kafka lag, and ensure audit events remain intact.
- **Security testing**: SAST + DAST + weekly dependency scans + annual penetration test.

---

## # 13) Operational runbooks (must exist)
- Provisioning failure runbook.
- Heartbeat failure / mass agent failure runbook.
- Key rotation & compromise runbook.
- Upgrade/rollback runbook (multisig + emergency path).
- DR & restore runbook (Postgres and audit rebuild).

---

## # 14) Acceptance criteria (deployment)
- Helm chart deploys cleanly into a staging cluster.
- Liveness/readiness pass and health endpoint returns OK.
- Integration acceptance tests for instantiate→run→destroy complete successfully.
- Prometheus metrics and Grafana dashboards populated.
- Audit events are produced and archived to S3.
- SentinelNet policy checks are enforced during provisioning.
- CI/CD pipeline includes canary, automated verification, and rollback on failure.

---

## # 15) Notes & operational suggestions
- Prefer managed services for Postgres and Kafka to reduce ops burden.
- Use GitOps (ArgoCD) for cluster promotion to enforce declarative state.
- Keep secrets centrally in Vault and avoid writing secrets to logs or DB.
- Document cost and quota for provisioning (expected egress, artifacts storage, ephemeral disk).
- Start with conservative HPA thresholds and tune with real traffic.

---

End of file.

