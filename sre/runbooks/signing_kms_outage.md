# Signing / KMS Outage Runbook

**Audience:** SRE + Security Engineering  
**Primary Goal:** Maintain fail-closed posture when KMS, signing proxy, or HSM endpoints are degraded. No unsigned changes may ship without jointly approved break-glass actions.

---

## 1. Detection & Triage
- Alerts triggered by `REQUIRE_KMS`/`REQUIRE_SIGNING_PROXY` health metrics (Prometheus: `signing_proxy_health`, `kms_sign_latency`, `kms_errors_total`).
- CI/Golden-path failures referencing `kernel/ci/require_kms_check.sh`.
- Service logs showing `signHash` failures (`shared/lib/audit.ts`) or startup guards tripping.
- Confirm whether outage is partial (one region) or full.

## 2. Immediate Actions (Fail Closed)
1. **Freeze deploys:** Pause CD pipelines; set `DEPLOY_BLOCK_SIGNING=1` in Spinnaker/Argo.
2. **Flip services to read-only mode:**
   ```bash
   kubectl -n illuvrse-kernel set env deploy/kernel-api SIGNING_DISABLED_REASON="KMS outage 2025-02-24T05:15Z"
   kubectl -n marketplace set env deploy/marketplace-api CHECKOUT_BLOCK_SIGNING=true
   ```
3. **Notify stakeholders:** #ops-signing Slack channel, Security on-call, Finance lead.
4. **Capture state:** Run `node kernel/tools/audit-verify.js --limit 50` and archive output for postmortem.

## 3. Diagnosis Checklist
- `curl -fsS $SIGNING_PROXY_URL/health`
- `aws kms describe-key --key-id "$KMS_KEY_ID"`
- Check VPC firewall / Security Groups for blocked egress.
- Inspect signing proxy logs (CloudWatch / Loki) for TLS or upstream errors.
- Verify TLS certificates (`openssl s_client -connect kms.example.com:443 -servername kms.example.com </dev/null`).

## 4. Break-glass Signing Flow (Auditor Approval Required)
> Only execute if outage exceeds 30 minutes **and** Security + Finance signoff documented in `IDEA/signoffs/security_engineer.sig`.
1. Generate emergency key pair inside Hardware secure enclave or offline laptop (never store in repo).
2. Update signer registry with temporary `signer_kid` and distribute public key via `kernel/tools/signers.json`.
3. Enable manual signing proxy mock (documented in `kernel/mock/signingProxyMock.js`) with emergency key.
4. Log every manual signature in `audit_events` under actor `service:signing-breakglass` including justification.
5. Schedule mandatory key destruction + audit verification after restoration.

## 5. Recovery
1. Validate upstream provider is healthy (steps in §3).
2. Rotate credentials/tokens used during outage.
3. Run full audit verification:
   ```bash
   node kernel/tools/audit-verify.js --database-url "$POSTGRES_URL" --signers kernel/tools/signers.json
   ```
4. Re-enable deploys, remove read-only flags, and post incident summary.

## 6. Post-Incident Checklist
- Update `RELEASE_CHECKLIST.md` with outage summary + follow-ups.
- File RCA with timeline, impact, controls effectiveness.
- Ensure S3 Object-Lock archives captured all manual signatures.
- Validate SentinelNet received corresponding verdict annotations.
