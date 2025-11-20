# Marketplace — Production Runbook & SRE Checklist

**Purpose**
Operational runbook for SREs and Operators to deploy, operate, and recover the Marketplace service in production. This document collects the concrete run steps, smoke checks, incident steps, rollback/playbook, and post-incident actions required for safe operation and sign-off.

**Audience:** SRE, Ops, Security, Release Engineer, On-call

**Prerequisites**

* You have read `marketplace/deployment.md` (topology, signing, S3 audit archive) and `marketplace/acceptance-criteria.md`.  
* CI job `marketplace-ci` passes for the commit you plan to deploy.
* Secrets (KMS keys, signing proxy API keys, DB credentials, S3 keys, payment provider secrets) are present in Vault/secret manager and mapped into the runtime environment.

---

## Quick checklist to verify BEFORE deploying to production

* [ ] CI: `marketplace-ci` green (unit + contract + e2e + audit-verify)
* [ ] `REQUIRE_SIGNING_PROXY=true` or `REQUIRE_KMS=true` enforced and signing endpoint reachable. (See KMS guidance.) 
* [ ] `KERNEL_API_URL` and Kernel mTLS/client certs configured and validated.
* [ ] `S3_AUDIT_BUCKET` configured with Object Lock and accessible by export job.
* [ ] CDN/WAF configured for origin TLS, CSP/HSTS set.
* [ ] Preview sandbox pool hardened and smoke-tested.
* [ ] Monitoring dashboards and critical alerts in place.
* [ ] Runbook tabletop exercise completed in staging with SRE & Security.

---

## Deployment steps (production)

Follow a canary-first deployment. Assume Kubernetes + Helm, but steps map to other orchestrators.

1. **Build & tag**

   * Build container image and tag with commit SHA:

     ```bash
     IMAGE=registry.example.com/illuvrse/marketplace:${GIT_SHA}
     docker build -t $IMAGE .
     docker push $IMAGE
     ```

2. **Create release PR & run CI**

   * Open PR with release image and bump chart. Ensure CI runs and artifacts are green.

3. **Deploy to Canary namespace**

   * Helm upgrade to canary namespace (5–10% traffic):

     ```bash
     helm upgrade --install marketplace-canary ./helm/marketplace \
       --namespace marketplace-canary \
       --set image.tag=${GIT_SHA} \
       --values values-canary.yaml
     ```
   * Wait for pods ready:

     ```bash
     kubectl rollout status deploy/marketplace -n marketplace-canary
     ```

4. **Canary smoke tests**

   * Run Playwright smoke tests against canary:

     ```bash
     PLAYWRIGHT_BASE_URL=https://canary.marketplace.example.com npx playwright test test/e2e/checkout.e2e.test.ts --project=chromium
     ```
   * Run audit-verify on a small generated sample or mock verification:

     ```bash
     node kernel/tools/audit-verify.js -d "postgres://..." -s kernel/tools/signers.json
     ```

     (See audit-verify; useful to verify audit chain produced by canary.) 

5. **Monitor metrics & logs**

   * Verify p95 latencies, error rates, signing errors, and audit export metrics for 30–60 minutes.
   * Look specifically for:

     * `marketplace.delivery_encrypt_failures_total`
     * `marketplace.audit_export_success_total`
     * `marketplace.checkout_latency_seconds`

6. **Promote to production**

   * If canary is healthy, promote with Helm to production:

     ```bash
     helm upgrade --install marketplace ./helm/marketplace --namespace marketplace-prod --set image.tag=${GIT_SHA} --values values-prod.yaml
     kubectl rollout status deploy/marketplace -n marketplace-prod
     ```

7. **Post-deploy validation**

   * Run full Playwright e2e (checkout & signedProofs).
   * Validate one end-to-end order (test buyer) in prod with a test payment provider sandbox account, confirm ledger proof and delivery proof are produced and archived.
   * Confirm audit export pipeline produces a sample export to `S3_AUDIT_BUCKET`. Run `audit-verify` on sample.

## Object Lock verification (S3 Audit + Delivery artifacts)

Run these commands before every prod cutover and weekly thereafter:

```bash
# Ensure bucket-level Object Lock policy is enforced
aws s3api get-object-lock-configuration --bucket "$S3_AUDIT_BUCKET"

# Spot check a recent export/delivery object for compliance (should return COMPLIANCE or GOVERNANCE)
aws s3api head-object \
  --bucket "$S3_AUDIT_BUCKET" \
  --key "audit/$(date +%Y/%m/%d)/sample.json" \
  --query 'ObjectLockMode'
```

If either command returns `null`, halt deploys and re-apply object lock per `infra/audit_export_policy.md`.

## Key rotation (Marketplace + ArtifactPublisher)

1. **Extract new signer public key** from KMS/signing proxy:

   ```bash
   SINGER_KID="artifact-publisher-signer-v2"
   scripts/update-signers-from-kms.sh "$SINGER_KID" > /tmp/new-signer.json
   ```

2. **Update signer registry** (`kernel/tools/signers.json`) and the Marketplace config map/secret referencing the signer kid.
3. **Deploy canary** with new signer env vars (`MARKETPLACE_SIGNER_KID`, `ARTIFACT_PUBLISHER_SIGNER_KID`).
4. **Verify** with a test checkout + `GET /proofs/{id}` ensuring `signer_kid` matches the rotated key.
5. **Revoke old key** by removing it from signer registry once all regions confirm new proofs.

---

## Smoke checks & manual verification

Use these commands after deployment to quickly validate health.

1. **Health check**

   ```bash
   curl -fsS https://marketplace.example.com/health | jq
   # Expected: ok: true, mTLS: true, signingConfigured: true
   ```

2. **Create a test order (non-production funds / test payment)**

   ```bash
   curl -X POST https://marketplace.example.com/checkout \
     -H "Authorization: Bearer <test-buyer-jwt>" \
     -H "Idempotency-Key: e2e-$(date +%s)" \
     -d '{"sku_id":"sku-e2e","buyer_id":"user:test@illuvrse","payment_method":{...}}'
   ```

   Confirm status transitions to `settled` and `delivery` proof produced.

3. **Verify proof & license**

   ```bash
   curl -fsS https://marketplace.example.com/order/<order_id>/license | jq
   curl -fsS https://marketplace.example.com/proofs/<proof_id> | jq
   ```

   Confirm signatures present and signer_kid set (public key should be registered in Kernel verifier).

4. **Audit export check**

   * Trigger or wait for audit export; download a small export and confirm Object Lock metadata.

---

## Rollback plan

If serious failures occur (signing failures, audit export failures, delivery corruption, or catastrophic latency), follow rollback:

1. **Immediate mitigation**

   * Scale down new deployment to zero or rollback to previous image:

     ```bash
     helm rollback marketplace <previous_release>
     kubectl rollout status deploy/marketplace -n marketplace-prod
     ```
   * If signing is failing: set `MAINTENANCE_MODE=1` or disable finalize endpoints to stop further unsigned artifacts. Notify Security and Finance.

2. **If rollback fails**

   * Promote previous working image to a temporary canary namespace and then to prod if needed.
   * If DB schema incompatible, consult DB migration plan in `marketplace/deployment.md` and run schema rollbacks only with DB team.

3. **Communicate**

   * Notify stakeholders via incident channel. Provide ETA for fix and next steps.

---

## Incident runbooks (common scenarios)

### A. Signing proxy / KMS outage

**Symptoms:** finalized orders fail due to signature errors; `signing_errors_total` spikes.

**Steps**

1. Check signing proxy health endpoint and logs.
2. Check KMS console for throttling/errors.
3. If signing proxy is down and immediate operations required, **do not** publish unsigned proofs. Contact Security to authorize emergency signing fallback (temporary signer) — follow key rotation process and record audit justification. 
4. If fallback not approved, mark Marketplace to stop finalization (set feature flag) and process a backlog when signing returns.

### B. Audit export failure

**Symptoms:** exports to `S3_AUDIT_BUCKET` failing or objects missing Object Lock metadata.

**Steps**

1. Check export worker logs and S3 credentials.
2. If bucket policy changed or Object Lock disabled, escalate to SRE and Security (compliance risk).
3. Pause promotions that depend on audit archiving until resolved.
4. Attempt manual export to recovery bucket and run `audit-verify`.

### C. Delivery encryption failures

**Symptoms:** Encrypted delivery fails to decrypt, or delivery decryption errors reported.

**Steps**

1. Verify key provenance (buyer key or ephemeral key id) and logs.
2. Recompute artifact hash; validate signed proof matches artifact.
3. If buyer key missing/corrupt, coordinate with buyer to reissue or provide recovery; if ephemeral key issue, rotate keys per key rotation process and re-run delivery.

### D. Preview sandbox breakout

**Symptoms:** Sandbox process attempts unauthorized network or file access.

**Steps**

1. Isolate pool: remove nodes from LB, revoke network routes.
2. Reap running containers.
3. Rotate sandbox image and redeploy hardened image.
4. Perform postmortem and update sandbox hardening rules.

---

## Post-incident & RCA

* After any incident, create a postmortem including:

  * Timeline of events, root cause, mitigations, and action items.
  * Audit artifacts: audit events, signing logs, Playwright traces, and server logs.
* Update runbooks and add test coverage to cover the failure scenario.

---

## Operational scripts & diagnostics

Keep these handy on the SRE runbook wiki or as CLI playbooks.

```bash
# Check signing proxy
curl -fsS $SIGNING_PROXY_URL/health | jq

# Quick audit verify for recent audit rows
node kernel/tools/audit-verify.js -d "postgres://$DB_USER:$DB_PASS@$DB_HOST:$DB_PORT/marketplace" -s kernel/tools/signers.json

# Export recent audit batch (example)
node marketplace/tools/export_audit_batch.js --from 2025-11-17T00:00:00Z --to 2025-11-17T23:59:59Z --out /tmp/export.jsonl.gz
```

---

## On-call escalation

* Level 1: Marketplace on-call SRE — page first.
* Level 2: Platform SRE (network / infra).
* Level 3: Security (signing/KMS incidents) & Finance (ledger/proof incidents).
* Level 4: Product / Ryan (SuperAdmin) for business-impacting decisions.

Populate contacts for your org in the section below.

---

## Final acceptance gating (pre-prod → prod)

* [ ] Canary smoke tests green for 1 hour (SMOKE window).
* [ ] Playwright e2e green in canary.
* [ ] Audit export & verification green for sample exports.
* [ ] Signing & KMS verified and signer public key published in Kernel verifier registry. 
* [ ] Preview sandbox tabletop executed & hardened.
* [ ] DR / restore drill completed successfully.
* [ ] Security Engineer & Finance Lead signed off.

---

## References

* `marketplace/deployment.md` (topology & signing details).
* `kernel/tools/audit-verify.js` for audit verification. 
* KMS IAM & key rotation: `docs/kms_iam_policy.md`, `docs/key_rotation.md`. 

---
