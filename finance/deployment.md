# Finance — Deployment & Operations Guide

Finance is the highest-assurance subsystem (double-entry ledger, invoicing, payouts, escrow, proofs). Deploy it in an isolated, tightly governed environment following this guide.

---

## 1. Isolation & architecture
- **Dedicated VPC / private subnets** with zero inbound internet access. Ingress only through bastion or controlled API gateway that enforces mTLS + hardware-backed MFA for humans.
- **Finance API + worker pods** running in their own Kubernetes cluster or bare-metal pool with strict NetworkPolicies. Separate workloads for synchronous APIs vs long-running payouts/reconciliation jobs.
- **Postgres cluster (HA)** hosts ledger tables. Storage-level encryption (AES-256) + TLS connections. Enable row-level security so only service role can mutate.
- **Signing service / HSM** for ledger proofs, payout manifests, and journal exports. Keys never leave HSM.
- **Message bus** (Kafka/SQS) for queued payouts and Finance ↔ Marketplace events.
- **Export tooling** writes immutable audit bundles to S3 object-lock bucket for auditors.

---

## 2. Core components
| Component | Purpose |
| --- | --- |
| Kubernetes namespace `finance-core` (or dedicated cluster) | Runs API, proof generator, payout orchestrator. |
| Postgres 15+ | Tables: `accounts`, `journal_entries`, `invoices`, `payouts`, `escrow_positions`, `ledger_proofs`. PITR + cross-region replica. |
| Redis/KeyDB (optional) | Cache account metadata, rate limits; no critical data stored here. |
| Object storage (S3) | Immutable audit exports (object-lock). |
| HSM/KMS | Signing ledger proof packages + payout manifests; integrate via signer proxy exposed inside VPC. |
| Finance console (CommandPad) | OIDC + hardware key enforcement for operators; proxies API calls with RBAC context. |

---

## 3. Environment variables & secrets

| Variable | Description |
| --- | --- |
| `FINANCE_PORT` | API listen address (default `8445`). |
| `FINANCE_DATABASE_URL` | Postgres DSN with verify-full TLS. Rotate via Vault. |
| `FINANCE_DB_APP_ROLE` | Role used for normal queries; migrations use elevated role. |
| `FINANCE_SIGNING_ENDPOINT` or `FINANCE_KMS_KEY_ID` | URL of signing proxy or cloud KMS key alias for ledger proofs. |
| `FINANCE_SIGNER_ID` | Identifier embedded in proof packages. |
| `FINANCE_MARKETPLACE_URL` / `FINANCE_MARKETPLACE_CERT` | Marketplace integration for order ingestion. |
| `FINANCE_PAYOUT_WEBHOOK_URL` | Optional callback for payout providers (ACH/crypto). |
| `FINANCE_MULTISIG_SERVICE_URL` | Kernel multisig endpoint for approvals. |
| `FINANCE_REDIS_URL` | Cache store for auth/session (if enabled). |
| `FINANCE_EXPORT_BUCKET` / `FINANCE_EXPORT_KMS_KEY_ID` | Audit bucket for proofs; object-lock enabled. |
| `FINANCE_SERVICE_ENV` | Environment tag for namespacing. |

Secrets are provisioned via Vault; pods use IRSA/workload identity to obtain short-lived tokens. Never store private keys or passwords in ConfigMaps.

---

## 4. Database schema & migrations
Canonical tables (define migrations under `finance/sql/migrations` as they are implemented):
- `accounts` — chart of accounts (type, currency, constraints). Enforce uniqueness on `(org_id, code)`.
- `journal_entries` — double-entry postings with `debit_account_id`, `credit_account_id`, `amount`, `currency`, `memo`, `manifest_signature_id`, `hash`, `prev_hash`. Triggers ensure `sum(debits) = sum(credits)` per `journal_id`.
- `invoices` — invoice lifecycle, references to journal entries, due dates, tax metadata.
- `payouts` — payout requests, approval state, multisig IDs, external transfer IDs.
- `ledger_proofs` — canonicalized range proofs referencing start/end journal ids, hash chain, signature, signer id.
- `escrow_positions` — holds, release schedule, underlying account references.

Run migrations via Atlas/Flyway inside the isolated network:

```bash
atlas migrate apply --dir finance/sql/migrations --url "$FINANCE_DATABASE_URL"
```

Store the resulting schema version + git sha in a `schema_version` table for audit. After every migration, rerun reconciliation tests to ensure journal balance constraints still hold.

---

## 5. Security, secrets & approvals
- **mTLS everywhere**: service-to-service calls (Marketplace, Kernel, banking providers) require mutual TLS. Certificates minted by internal CA, rotated automatically.
- **RBAC & MFA**: operator actions flow through CommandPad (OIDC + hardware keys). Finance API never accepts raw human credentials.
- **Multisig**: payouts above threshold and ledger proof publication require Kernel multisig approvals (3-of-5). Store manifest IDs with approvals for audit.
- **Secrets**: DB creds scoped per environment and stored in Vault with dual control. Signing proxy authenticates callers via SPIFFE ID or workload identity. No SSH access without break-glass approvals.

---

## 6. Deployment workflow
1. **Provision VPC** with private subnets, NAT for outbound-only, security groups allowing only required east-west flows.
2. **Set up Postgres** (HA, PITR). Enable logical replication for analytics read-only copies. Apply IAM/database roles for app, migrations, readonly.
3. **Create S3 export bucket** with object-lock compliance mode (>=7 years) and SSE-KMS. Configure replication to secondary region.
4. **Deploy signing service/HSM client**; register key alias `finance-ledger-${env}` and grant Finance workload `Sign` permission only.
5. **Apply migrations** (see §4) via CI job or Helm hook. Block application rollout until migrations succeed.
6. **Deploy API + workers** using Helm with PodSecurityPolicies (no host networking, no privilege). Configure liveness probes guarding DB + signer connectivity.
7. **Configure scheduled jobs**: nightly reconciliation, proof generation, export uploader, backup verification.
8. **Wire integrations**: Marketplace calls `POST /finance/journal` via mTLS, payout providers whitelisted, Kernel multisig reachable over private link.
9. **Smoke tests**: run synthetic journal entry, generate proof for short range, execute payout in sandbox mode, and validate audit events.

---

## 7. Monitoring & alerts
- Metrics: journal throughput, ledger latency, proof generation duration, payout queue depth, signer latency, DB replication lag.
- Alerts: unbalanced journal attempt, signer failures, proof generation failures, backlog > SLA, Vault secret nearing expiry, DB replica lag > 30s.
- Logs: ship to SIEM with field-level encryption for sensitive values.

---

## 8. Runbooks
1. **Ledger imbalance detected**  
   - Freeze new postings (`FINANCE_WRITE_MODE=readonly`), identify offending journal id via hash chain, roll back transaction if within reversible window or create compensating entry with approval. Run reconciliation job, then lift freeze once balance restored.
2. **Signer/HSM outage**  
   - Switch Finance into degraded mode: accept journal entries but pause proof publication. Queue pending proofs, notify auditors. Restore HSM connectivity, then re-sign queued ranges and publish to S3 + Kernel.
3. **Payout pipeline failure**  
   - Mark payouts `pending_retry`, notify treasury, suspend escrow releases. Once provider recovers, replay queue, compare statuses with bank statements, and post reconciliation entries.
4. **Database failover**  
   - Promote standby via managed service, update connection strings. Run integrity checks: `SELECT SUM(amount) FILTER (WHERE dr_cr='debit') - SUM(amount) FILTER (WHERE dr_cr='credit') FROM journal_lines GROUP BY journal_id` must return zero. Rebuild replicas, resume writers.
5. **Audit export corruption**  
   - If hash mismatch occurs when verifying S3 export, retain corrupted copy for forensics, regenerate export from journal source, validate locally, upload new object (object-lock), and append corrective audit record referencing superseded bundle.

---

## 9. Compliance checklist
- [ ] Dedicated network + access controls enforced; firewall rules reviewed quarterly.
- [ ] Postgres encrypted, PITR enabled, restore drill executed.
- [ ] KMS/HSM key policies reviewed; signer logs shipped to SIEM.
- [ ] Object-lock audit bucket created + replication verified.
- [ ] Multisig approval flow tested for payouts + proofs.
- [ ] Monitoring dashboards live with alert-to-runbook mapping.
- [ ] Reconciliation + proof generation pass in staging before production cutover.
