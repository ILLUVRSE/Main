# Agent Manager — Deployment

## Components
- Agent Manager service (container) with autoscaling.
- Provisioner: Kubernetes (or container runtime) adapter to create agent pods.
- DB: Postgres for template + agent state.
- Vault for secrets; Resource Allocator & SentinelNet accessible via mTLS.
- Event Bus (Kafka/Redpanda) for audit events.

## Env & secrets
- `DATABASE_URL`, `VAULT_ADDR`, `VAULT_ROLE`, `RESOURCE_ALLOCATOR_URL`, `SENTINELNET_URL`.
- mTLS cert for Kernel & Agent Manager (`MTLS_CERT`, `MTLS_KEY`, `MTLS_CA`).
- KMS config for signing agent manager events, if required.

## K8s example
- Deployment with 2-3 replicas, HPA on CPU and custom metrics.
- Use PodSecurityPolicy/PSA to ensure isolation.
- ServiceAccount with Pod Identity for Vault injection.

## Secrets injection
- Use Vault Agent injector or CSI driver to inject secrets (not environment variables in prod).
- Short-lived secrets and automatic renewal.

## Provisioning runtime
- Use namespace-per-division or label-based multi-tenancy.
- RBAC: enforce least privilege.

## Observability & SLOs
- Metrics: `agent_instantiation_time_seconds`, `agent_running_count`, `agent_heartbeat_latency`.
- SLO: 95% agent instantiations succeed within target time (configurable).

## Backup & recovery
- Postgres backup (PITR). Restore drill must reinstantiate an agent from persisted metadata.

## Canary & rollback
- Deploy Agent Manager with canary versions for new template logic.
- Use ability to migrate agent states and rollback agent runtime images.

