# Control-Panel — Deployment & Production Runbook

**Purpose**
Deployment guide for the Control-Panel operator UI (Next.js App Router). Covers topology, transport security (mTLS), SSO, signing proxy, secrets, scaling, SLOs, canary rollout and key rotation. Follow this exactly for production deployment.

**Audience:** SRE / Ops / Security / Release Engineer

---

## 1. Architecture / topology (high-level)

```
Users (browser) -> CDN / WAF -> Control-Panel (Next.js server(s) behind LB) -> 
  ├─ Kernel (server-to-server mTLS / KERNEL_API_URL)
  ├─ Signing Proxy (SIGNING_PROXY_URL) or KMS
  ├─ SentinelNet (optional read-only)
  └─ Reasoning Graph (read / annotate via Kernel)
```

**Key principles**

* All Kernel interactions are proxied server-side; browsers never receive Kernel tokens.
* Operator secrets (KERNEL_CONTROL_PANEL_TOKEN, SIGNING_PROXY_API_KEY, session secret) live only in the server environment / secret manager.
* Production requires mTLS or private network for all service-to-service traffic. Demo/dev may run without mTLS but must be blocked in production. 

---

## 2. Required environment variables

Provide these in production from your secret manager (Vault / AWS Secrets Manager / Kubernetes Secret). Do **not** commit them.

**Server runtime**

* `NODE_ENV=production`
* `PORT` (container/host port)
* `KERNEL_API_URL` — Kernel endpoint ([https://kernel.prod.internal](https://kernel.prod.internal))
* `KERNEL_CONTROL_PANEL_TOKEN` — server-side bearer token (or omitted if using mTLS)
* `SIGNING_PROXY_URL` — optional signing proxy for operator actions
* `SIGNING_PROXY_API_KEY` — api key for signing-proxy (if used)
* `CONTROL_PANEL_SESSION_SECRET` — secure random 32+ byte string for cookie signing
* `REASONING_GRAPH_URL` — optional
* `SENTINEL_URL` — optional
* `OIDC_ISSUER` — OIDC provider issuer URL
* `OIDC_CLIENT_ID` — Control-Panel client id
* `OIDC_CLIENT_SECRET` — secret stored in vault
* `OIDC_CALLBACK_URL` — production callback URL
* `SESSION_COOKIE_SECURE=true`
* `CSP_POLICY` — content security policy string (if you apply CSP)

**Feature toggles / production guard**

* `DEV_SKIP_MTLS=false` (must be false in production)
* `REQUIRE_SIGNING_PROXY=true` — enforce signing proxy usage (or `REQUIRE_KMS=true` if KMS required)

**Observability**

* `PROM_PUSH_GATEWAY` or `PROM_ENDPOINT`
* `SENTRY_DSN` or equivalent

---

## 3. Transport security (mTLS / bearer tokens)

**Production must use one of:**

* **mTLS** between Control-Panel ↔ Kernel (recommended). Provision server cert & key via Vault and configure TLS client cert on the Control-Panel side. Kernel must trust CA.
* **Server-side bearer token** only when mTLS is not available — keep token vault-only and rotate regularly.

**mTLS recommendation**

* Use short-lived certs issued by internal CA (via Vault PKI or ACM PCA). Mount certs into pods (K8s secrets from Vault).
* Health endpoints should report whether mTLS is configured (`/health` shows mTLS=true/false).

**CI / Staging**

* Allow `DEV_SKIP_MTLS=true` in staging only if `NODE_ENV != production`. Startup must fatal if `NODE_ENV=production` and `DEV_SKIP_MTLS=true`. (Enforce in server startup.)

---

## 4. OIDC / Authentication

**Requirements**

* Use OIDC with enforced roles mapping (`kernel-admin`, `kernel-approver`, `operator`). Map claims to UI roles server-side.
* Sessions stored in HTTP-only secure cookies signed with `CONTROL_PANEL_SESSION_SECRET`. No tokens in localStorage.
* Admin password fallback allowed only for local dev; **disabled in production**.

**Config checklist**

* Register Control-Panel client with OIDC provider (redirect URIs).
* Validate `id_token` server-side (`/api/session`) and map roles to UI capabilities.
* Implement 2FA enforcement at IdP (SSO-level) for operator accounts.

---

## 5. Signing / Ratification (SIGNING_PROXY / KMS)

**Production signing model**

* Operator ratification and any signing required by Kernel should be done either via:

  * **Signing Proxy:** Control-Panel calls `SIGNING_PROXY_URL` over mTLS / private network with `SIGNING_PROXY_API_KEY`, or
  * **KMS:** Control-Panel triggers server-side KMS flow (Cloud KMS/HSM) via a signing service (recommended instead of embedding keys in app).

**Config**

* `REQUIRE_SIGNING_PROXY=true` or `REQUIRE_KMS=true` for production. If neither is set, server must refuse to boot in production.

**Audit**

* Every signing action must produce an audit event (signed by Kernel or signing proxy) and record signer ID. UI must show signer metadata in confirmation modal.

**Key rotation**

* Rotate signing proxy API key or KMS key according to runbook (see Key Rotation section). Publish public keys to Kernel verifier registry before disabling previous keys.

---

## 6. Secrets & Vault integration

**Do not put secrets in repo.** Use Vault or your secret manager.

**Recommended approach**

* Store session secret, OIDC client secret, signing-proxy key, and Kernel token in Vault. Use a sidecar or init container to pull secrets into ephemeral k8s secrets or use CSI driver for Vault.

**Example: Kubernetes (Helm)**

* Create `values-production.yaml` referencing secrets:

```yaml
env:
  - name: KERNEL_API_URL
    value: https://kernel.prod.internal
  - name: CONTROL_PANEL_SESSION_SECRET
    valueFrom:
      secretKeyRef:
        name: control-panel-secrets
        key: session_secret
```

---

## 7. Deployment: Kubernetes / containers

**Pod spec**

* Run Next.js server in Node 20 image.
* Use readiness/liveness probes: `/ready` should check DB (if any), Kernel probe, and mTLS readiness. `/health` returns transport info.
* Run in at least 2 replicas behind a Load Balancer. Use PodDisruptionBudget minAvailable=1.

**Ingress**

* Put Control-Panel behind CDN & WAF. Enforce TLS at edge and use mutual TLS for upstream traffic where required.

**Scaling**

* Horizontal Pod Autoscaler based on CPU & request latency (p95). Set target CPU and scale limits per traffic profile.

**Config maps / secrets**

* Keep env in sealed secrets; do not print them in logs.

---

## 8. Observability, SLOs & alerts

**Metrics to export**

* `control_panel.requests_total` (labels: route, status)
* `control_panel.request_latency_seconds` (histogram: route)
* `control_panel.operator_actions_total{action=...}`
* `control_panel.sentinel_verdict_latency_seconds`

**SLOs**

* `p95` request latency for critical UI routes < 300ms for operator flows.
* Error rate < 1% for operator actions.

**Alerts**

* High error rate (>1% 5m), high latency (p95 > 600ms), failed signings, inability to reach Kernel.

**Tracing**

* Inject trace IDs into audit payloads so traces can be linked to audit events.

---

## 9. Canary & rollout strategy

**Canary steps**

1. Deploy to a canary namespace with 5–10% traffic (DNS split / Load Balancer).
2. Run automated smoke tests (Playwright) against canary.
3. Monitor metrics and SentinelNet-related behavior. If canary fails, auto-rollback via deployment pipeline.

**Multisig upgrade gating**

* Upgrades to policy-sensitive parts require multisig via Kernel. Control-Panel must display SentinelNet verdicts and prevent apply until Kernel marks upgrade as approved.

---

## 10. Backup, restore & DR

* Back up Control-Panel persistent data (sessions or DB if used) with rotation.
* Restore procedure: deploy previous container image, restore config & secrets, validate `/ready` checks.

---

## 11. Key rotation runbook (signing & session keys)

**Signing proxy / KMS key rotation**

1. Create new key in KMS / signing proxy.
2. Export / register public key to Kernel verifier registry (`kernel/tools/signers.json`). 
3. Deploy Control-Panel referencing new key or signing proxy endpoint.
4. Verify signatures against new key across services (run audit verify).
5. Decommission old key after overlap period.

**Session secret rotation**

* Rotate `CONTROL_PANEL_SESSION_SECRET` in two-step rolling manner:

  1. Accept both old and new session secret for a transition window (server supports signature verification with old secret).
  2. After window, remove old secret and enforce new secret only.

---

## 12. CI & release pipeline

**CI checks**

* Lint / type-check / unit tests.
* Playwright e2e run against staging / mocks.
* `./scripts/ci/check-no-private-keys.sh` must run in pipeline to ensure no private key committed.
* Guard: For `refs/heads/main` deploys, enforce `REQUIRE_SIGNING_PROXY` / `REQUIRE_KMS` and fail if unset.

**Release steps**

1. Create PR with docs & code changes.
2. CI runs unit tests and Playwright e2e against a mocked stack.
3. Merge → CI builds image, pushes to registry.
4. Deploy to canary; run canary smoke tests.
5. After success & manual checks, promote to production.

---

## 13. Emergency procedures

**If Kernel becomes unreachable**

* UI should surface degraded mode warning and disable state-modifying controls.
* SRE: revert to last known-good Control-Panel version, and follow Kernel recovery runbook.

**If signing proxy fails**

* Block all signing-requiring actions in UI. SRE: run failover signing proxy or enable emergency signing (requires Security sign-off).

**If secrets leaked**

* Rotate offending secret immediately, revoke tokens, and audit accesses. Notify Security and log audit events.

---

## 14. Example health probe output (recommended)

`GET /health`

```json
{
  "ok": true,
  "mTLS": true,
  "kernelConfigured": true,
  "signingProxyConfigured": true,
  "uptime": 12345
}
```

---

## 15. Checklist before promoting to production

* [ ] `NODE_ENV=production` guarded startup (`DEV_SKIP_MTLS` false)
* [ ] mTLS or server-side bearer token to Kernel configured and tested
* [ ] Signing proxy or KMS configured and verified with audit signoffs
* [ ] OIDC client configured and integration validated (roles mapping)
* [ ] All secrets injected via Vault/Secrets Manager (no secrets in repo)
* [ ] Playwright e2e passed in staging canary deployment
* [ ] Metrics & alerts configured and validated
* [ ] Runbook tabletop drill executed (emergency ratification + rollback)
* [ ] Security Engineer review completed and signed

---

## 16. Useful commands & diagnostics

```bash
# Validate env and readiness locally
NODE_ENV=production DEV_SKIP_MTLS=false node dist/server.js

# Probe health
curl -sS https://control-panel.prod.internal/health | jq

# Verify signing proxy reachability
curl -fsS -H "Authorization: Bearer $SIGNING_PROXY_API_KEY" $SIGNING_PROXY_URL/health
```

---

### Notes & references

* Control-Panel implements server-side Kernel proxy routes and demo mode; playbook and runbooks should align with `control-panel/README.md`. 
* Signing & audit expectations align with Kernel’s signing & audit model — ensure public keys are registered in Kernel verifier registry prior to key swap. 

---
