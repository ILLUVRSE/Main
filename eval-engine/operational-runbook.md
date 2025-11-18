# Eval Engine & Resource Allocator — Operational Runbook

**Purpose**
Provide runbook procedures to detect, mitigate, and recover from incidents affecting Eval Engine and Resource Allocator. Operators must follow these steps exactly, document actions in an incident ticket, and raise postmortems for P1/P0 incidents.

**Assumptions**

* The on-call rotation, pager, and escalation lists are managed in the org on-call system (PagerDuty / Opsgenie).
* Required tools: `kubectl`, `psql` or DB access tooling, `awscli` (or cloud cli), `node`/`npx` for local scripts, access to logs (ELK/Cloud Logging) and metrics (Prometheus + Grafana).
* Secrets are in Vault (or secret manager) and accessible by SRE.

---

## Contacts & escalation

* Primary On-call: Eval SRE (pager)
* Secondary On-call: Platform SRE Lead
* Security on-call: Security Pager
* Finance on-call: Finance SRE
* ML Owner (Eval Lead): (name/email)
* Product Owner (Resource Allocator): (name/email)

(Replace placeholders with org contacts.)

---

## Runbook conventions

* Severity levels: P0 (service down / data loss), P1 (major functionality degraded), P2 (partial impact), P3 (minor).
* Always open an incident ticket for P0/P1. Record timestamps and actions.
* When taking an action that may reduce visibility (e.g., switching to emergency signer), take screenshots, record command outputs, and annotate the incident ticket.

---

## Health endpoints & quick checks

Run these checks first to determine scope:

```bash
# Basic health
curl -sS http://eval-engine.local/health | jq
curl -sS http://eval-engine.local/ready | jq

# Kernel connectivity
curl -sS http://eval-engine.local/health | jq .kernelConfigured

# Metrics
curl -sS http://prometheus.local/api/v1/query?query=eval_engine.eval_submissions_total

# Logs (K8s)
kubectl -n eval-engine logs deploy/eval-engine --tail=200
kubectl -n eval-engine logs deploy/resource-allocator --tail=200
```

If health/ready failing, check DB, KMS, Kernel, and SentinelNet connectivity in the readiness output.

---

## Incident: KMS / Signing failures (P0 / P1)

**Symptoms**

* Audit signing errors in logs: `SIGNING_FAILURE` / `KMS Sign failed`
* `ready` indicates signer not configured.
* CI failing with `REQUIRE_KMS` guard.

**Immediate actions**

1. **Pager & ticket** — Acknowledge pager, open incident ticket, set priority according to impact. Notify Security on-call.
2. **Check KMS status**:

   * For AWS KMS: `aws kms describe-key --key-id $AUDIT_SIGNING_KMS_KEY_ID`
   * Check Cloud provider status dashboard for outages.
3. **Inspect logs**:

   * `kubectl -n eval-engine logs deploy/eval-engine | grep -i sign`
4. **Fallback**:

   * If the signing outage is transient and organization permits, enable a **signing-proxy fallback** that is approved for emergency use. Only do this after Security approval AND record the operation in audit.
   * Command (example - operator-run):

     ```bash
     kubectl -n eval-engine set env deploy/eval-engine SIGNING_PROXY_URL=https://signer-emergency.internal
     ```
   * NOTE: If `REQUIRE_KMS=true` is enforced, follow emergency process: set `REQUIRE_KMS=false` only under explicit authorization and record audit event `audit/emergency_signer`.
5. **If no fallback**:

   * Mark service read-only (reject writes) by toggling feature flag or set `DEV_READ_ONLY=true` via config map. With Kernel mediation, a safe read-only mode should be available:

     ```bash
     kubectl -n eval-engine patch configmap eval-engine-config --type merge -p '{"data":{"MODE":"read-only"}}'
     ```
6. **Monitor**: watch for signing restoration; revert fallback when restored and run audit replay to validate signatures.

**Post-incident**

* Run `kernel/tools/audit-verify.js` for events produced during outage window once back to normal.
* Postmortem: root cause, timeline, why fallback used (if used), remediation.

---

## Incident: SentinelNet outage or high denial spike (P1)

**Symptoms**

* Promotions or allocations being denied unexpectedly.
* `eval_engine.promotion_policy_denials_total` spike in Prometheus
* `sentinelnet` health failing or high latency.

**Immediate actions**

1. **Confirm**: Check SentinelNet health:

   ```bash
   curl -sS http://sentinelnet.local/health | jq
   kubectl -n sentinelnet logs deploy/sentinelnet --tail=200
   ```
2. **Policy simulation**: Use `simulate=true` against SentinelNet to reproduce denial reason. If denial is legitimate, investigate policy change.
3. **If SentinelNet unavailable**:

   * Option A — Enable degraded mode (if acceptable): instruct Eval Engine to treat SentinelNet as `best-effort` for low-risk flows (temporary config). Document risk.
   * Option B — Fail closed (preferred for security-critical orgs): keep promotions blocked; notify teams & update status page.
4. **Runbook**:

   * Restart sentinelnet pods: `kubectl rollout restart deploy/sentinelnet -n sentinelnet`
   * If using Kafka, check consumers and offsets: `kubectl -n sentinelnet logs`
5. **If denial spike due to policy change**:

   * Determine commit that changed policy (Control-Panel multisig apply?). Revert or patch policy, or run simulation and adjust canary thresholds.

**Post-incident**

* Postmortem including policy change that caused spike; run tabletop to avoid repeat.

---

## Incident: Finance / ledger failures (P1)

**Symptoms**

* Allocations stuck in `pending_finance`.
* `allocator.settlement_failures_total` increases.
* Finance API returns errors or ledger proofs fail signature validation.

**Immediate actions**

1. **Check Finance uptime** and logs. Contact Finance on-call.
2. **Inspect pending allocations**:

   ```bash
   psql $ALLOC_DATABASE_URL -c "select * from allocations where status = 'pending_finance' limit 50;"
   ```
3. **Retry logic**:

   * Resource Allocator should have retry with DLQ; inspect DLQ for failed settlement messages.
   * For transient Finance outages, requeue DLQ entries after Finance restores.
4. **If ledger proofs fail signature verification**:

   * Retrieve ledger proof and validate with `finance/tools/verify_ledger_proof.sh` or suggested tool:

     ```bash
     ./finance/tools/verify_ledger_proof.sh --proof-id <id>
     ```
   * If signature mismatch, escalate to Finance and Security.
5. **Mitigation**:

   * If erroneous ledger proofs accepted earlier, freeze allocations and run reconciliation; create `audit.reconciliation` event.

**Post-incident**

* Reconcile allocations and ledger entries; produce reconciler run report and postmortem.

---

## Incident: Audit verification failures (P1 / P0)

**Symptoms**

* `kernel/tools/audit-verify.js` reports hash or signature mismatch.
* Nightly audit verification job fails.

**Immediate actions**

1. **Stop** any processes that might write new audit events (if possible) to avoid further inconsistency.
2. **Identify scope**: determine earliest failing event ID and timestamp from `audit-verify` output.
3. **Check parity vectors and canonicalizer**:

   * Verify that the service canonicalizer code was not changed (regression).
   * Run parity tests locally with `test/vectors/audit_canonical_vectors.json`.
4. **Check storage**:

   * Compare DB rows with S3 archive canonical bytes for the event. If archive mismatch, inspect S3 object integrity.
   * If corruption occurred, try to retrieve previous version from S3 versioning.
5. **If missing events**:

   * Run audit stager/replay to ensure pending-signature rows are completed.
   * If permanent loss, create signed `audit.reconciliation` event describing the gap and remedial steps; escalate to Security.
6. **If signature verification fails**:

   * Fetch `signer_kid` and public key from `kernel/tools/signers.json`. Use `openssl` or `kms` to verify signature.
   * If public key rotation occurred incorrectly, coordinate with Security to restore correct key or verify rotation procedure.

**Post-incident**

* Root cause analysis and verify fixes to canonicalizer or storage. Add tests preventing regression.

---

## Incident: Database issues (P0 / P1)

**Symptoms**

* DB unreachable or errors on writes; `ready` failing; high latency.

**Immediate actions**

1. **Failover**:

   * If primary DB down and replicas/PITR available, follow DB failover playbook (cloud-specific). For Postgres managed services, trigger failover or restore.
2. **Restore from snapshot** (if needed) — only after analysis:

   * Restore DB into test cluster and run `./scripts/rebuild_from_audit.sh` to replay audit.
3. **Mitigation**:

   * Put service in degraded read-only mode until DB restored.
   * Notify dependent systems (Kernel / Control-Panel / Marketplace).
4. **Data integrity**:

   * After restoration, re-run `kernel/tools/audit-verify.js` and all module verify tools.

**Post-incident**

* Postmortem and review PITR & monitoring thresholds.

---

## Routine maintenance & drills

### Key rotation (planned)

1. Create new KMS key (or signer) in KMS.
2. Export public key and add to `kernel/tools/signers.json` (or registry).
3. Deploy Eval Engine referencing new `AUDIT_SIGNER_KID` in staging (`dual-mode` to accept both old and new).
4. Run signing verification test.
5. Promote to production after overlap period.
6. Revoke old key after confirmation.

### Disaster recovery drill

* Monthly: Restore Postgres snapshot in test cluster, import audit archive, run audit-verify to ensure chain verifies, and run acceptance E2E (promotions/allocations).

---

## Runbook commands & utilities

**Audit verify**:

```bash
node kernel/tools/audit-verify.js -d "$AUDIT_DB_URL" -s kernel/tools/signers.json --from 2025-11-18 --to 2025-11-20
```

**List pending audit staging**:

```bash
psql $DATABASE_URL -c "select eventId, status, created_at from audit_staging where status='pending_signature' order by created_at limit 50;"
```

**Requeue DLQ for Finance**:

```bash
kubectl -n eval-engine exec deploy/resource-allocator -- /bin/sh -c "python3 scripts/requeue_dlq.py --queue-name finance-settle-dlq"
```

**Set service to read-only** (example config-map change):

```bash
kubectl -n eval-engine patch configmap eval-engine-config --type merge -p '{"data":{"MODE":"read-only"}}'
kubectl -n eval-engine rollout restart deploy/eval-engine
```

---

## Post-incident checklist

* Document timeline in incident ticket (what, when, who).
* Restore normal operations and re-run acceptance tests (audit verify and module E2E).
* Draft and publish postmortem for P0/P1 incidents within SLA (e.g., 5 business days).
* Remediate root cause with tickets and assign owners.

---

## Appendix — Quick troubleshooting table

| Symptom                  |                  First check | Quick mitigation                                                           |
| ------------------------ | ---------------------------: | -------------------------------------------------------------------------- |
| Signer/KMS errors        | `kubectl logs` + KMS console | Switch to signing-proxy fallback (with Security approval) or set read-only |
| Audit-verify failure     |             Run audit-verify | Pause writes, find earliest mismatch, run parity tests                     |
| SentinelNet denials      |    sentinelnet/health & logs | Revert policy / enable degraded mode / restart sentinelnet                 |
| Finance settlement fails |     Finance API health + DLQ | Requeue DLQ, alert Finance, run reconciler                                 |
| DB unreachable           |  DB console + replica status | Failover or restore from snapshot                                          |

---

End of `eval-engine/operational-runbook.md`.

---
