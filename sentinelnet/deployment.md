# SentinelNet — Deployment

## Topology
- Highly available frontends behind load balancer.
- Policy registry DB (Postgres) and distributed in-memory cache for rules.
- Worker pool for simulation and slow detection tasks.

## Secrets
- mTLS certs to accept Kernel calls.
- Vault for admin credentials and multsig key storage.

## Canary & simulation
- Deploy policies in simulation in staging first; provide metrics dashboards.

## Observability & SLOs
- Metrics: check latency p50/p95/p99, decision distribution, false-positive rate.
- SLO target to be defined with Kernel; default target p95 < 100ms for synchronous checks.

## Security
- RBAC for policy editing; multisig process for high-severity changes.

