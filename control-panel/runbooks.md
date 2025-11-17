# Control-Panel — Runbooks (Emergency Ratification, Rollback, On-call)

**Purpose**
Actionable runbooks for operators and SREs to handle emergency ratification, upgrade rollback, degraded Kernel/signing proxy, and other common incidents. These steps assume you have the Control-Panel deployed per `control-panel/deployment.md` and backend credentials are stored in your secret manager. Follow the “Safety & approvals” section before performing any production-changing action.

**Audience:** Operators, SRE, Security Engineer

**Preconditions / Safety & approvals**

* Only authorized operator roles (`kernel-approver`, `kernel-admin`) may ratify emergency actions. Confirm identity via SSO/OIDC.
* All ratification / rollback actions must be recorded as AuditEvents. Do not attempt manual DB edits.
* If an action involves signing, ensure `SIGNING_PROXY` or KMS is available or follow the emergency signing override only with Security approval.
* When in doubt, consult Security and the Kernel on-call before applying an emergency change.

---

## Table of contents

1. Emergency Ratification (UI-driven)
2. Emergency Ratification (CLI / SRE fallback)
3. Upgrade Rollback (UI-driven)
4. Upgrade Rollback (CLI / SRE fallback)
5. Kernel unreachable — triage & mitigation
6. Signing proxy or KMS outage — triage & mitigation
7. SentinelNet deny / policy block — triage & mitigation
8. Secret compromise — immediate steps
9. Post-incident: evidence, audit, remediation
10. Contacts & escalation matrix

---

## 1) Emergency Ratification — operator UI flow (preferred)

**Goal:** allow an authorized operator to ratify an emergency apply when SentinelNet / policy gating has blocked normal apply flows or when immediate corrective action is required.

**When to use:** Emergency bugfix, urgent rollback, critical security patch that cannot wait for normal multisig window.

**Steps**

1. **Confirm authority & gather context**

   * Verify the operator identity (SSO) and role. Ensure at least one Security Engineer and one SRE are available to observe.
   * Obtain the Kernel upgrade id or manifest id (from the upgrades dashboard).

2. **Open the Upgrade Detail page**

   * UI path: `/upgrades/[id]` → review the proposed changes, diff, SentinelNet verdict, and Reasoning Graph trace.
   * Confirm the rationale and risks. Attach a short justification in the “ratification notes” field.

3. **Check audit & preconditions**

   * Open Audit Explorer → locate audit events for the upgrade. Verify previous approvals and SentinelNet decisions are recorded.
   * Confirm no outstanding blocking incidents (e.g., Kernel health, signing proxy) that make an emergency apply unsafe.

4. **Sign & ratify**

   * Click **Emergency Apply** → the modal will ask for ratification text. Enter: `EMERGENCY_RATIFY: <short justification>, incident:<INCIDENT_ID>, operator:<your_sso_email>`.
   * If signing proxy / KMS is configured, the UI will call signing flow. Confirm modal shows `Signed by: <signer id>`. If signing proxy is down, follow emergency signing steps (section 6).

5. **Monitor Kernel response**

   * After submitting, the Control-Panel will proxy the Kernel apply request. Watch the status on the Upgrade Detail page. Kernel should return an `applied` status or `apply_failed` with details.
   * Tail Control-Panel / Kernel logs for immediate failures.

6. **Verify post-apply**

   * Validate smoke checks (health of the service impacted by the upgrade). Run automated post-apply checks (Playwright smoke tests, system health queries).
   * Confirm AuditEvent recorded for the emergency apply (id, signature, operator, ratification notes).

**Abort / rollback:** If immediate adverse effects are observed, trigger the rollback runbook below.

---

## 2) Emergency Ratification — CLI / SRE fallback

Use this when UI is unavailable. **Only SRE + Security** should run.

**Prereqs**

* A machine with access to Vault / secret store for `KERNEL_CONTROL_PANEL_TOKEN` or mTLS client cert.
* `jq`, `curl` available.

**Steps**

1. Fetch secret (example with Vault CLI):

```bash
export KERNEL_URL="https://kernel.prod.internal"
export TOKEN="$(vault kv get -field=token secret/control-panel/kernel_token)"  # example
```

2. Submit ratification via Control-Panel server-side proxy (preferred), or directly to Kernel if UI proxy is down **and Security approves**:

```bash
# If Control-Panel API proxy is healthy:
curl -sS -X POST "https://control-panel.prod.internal/api/kernel/upgrade/emergencyApply" \
  -H "Authorization: Bearer $CONTROL_PANEL_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upgradeId":"<ID>", "notes":"EMERGENCY_RATIFY: reason=..., operator=alice@example.com"}' | jq

# If Control-Panel is down and Security approves Kernel direct call:
curl -sS -X POST "$KERNEL_URL/upgrades/<ID>/apply?emergency=true" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actor":"alice@example.com","notes":"EMERGENCY_RATIFY: ..."}' | jq
```

**Important:** Direct Kernel calls bypass the audit guarantees the proxy provides. Only use with Security approval and then immediately create an AuditEvent via `kernel/audit` if Kernel did not emit one.

3. Monitor the response and logs, same verification as UI flow.

---

## 3) Upgrade Rollback — operator UI flow

**Goal:** restore pre-upgrade state when an applied upgrade causes regressions.

**Steps**

1. **Identify upgrade & confirm rollback criteria**

   * Reproduce the issue or confirm the monitoring alerts indicate regression.
   * Confirm rollback will address the issue and record the justification.

2. **Open Upgrade Detail**

   * Click **Rollback** (if available). Fill rollback rationale.

3. **Run rollback**

   * The UI submits rollback to Kernel via server-side proxy. Kernel triggers the apply/rollback process (may be a multisig gated action depending on risk).

4. **Monitor progress**

   * Watch rollback status in the UI. Check infrastructure logs & smoke tests.

5. **Verify**

   * Validate that the previous state has been restored and that audit events show rollback applied with operator identity & signature.

---

## 4) Upgrade Rollback — CLI / SRE fallback

**Steps**

1. Obtain secrets as in Emergency Ratification CLI.
2. Submit rollback:

```bash
curl -sS -X POST "https://control-panel.prod.internal/api/kernel/upgrade/<ID>/rollback" \
  -H "Authorization: Bearer $CONTROL_PANEL_ADMIN_TOKEN" \
  -d '{"notes":"Rollback due to regression: ...", "actor":"sre-oncall@example.com"}' | jq
```

3. If Control-Panel is down and Kernel direct call approved:

```bash
curl -sS -X POST "$KERNEL_URL/upgrades/<ID>/rollback" -H "Authorization: Bearer $TOKEN" -d '{}'
```

4. Monitor logs and validate rollback.

---

## 5) Kernel unreachable — triage & mitigation

**Symptoms:** UI shows Kernel unreachable; `/api/kernel/*` proxy returns 5xx; Health shows `kernelConfigured=false`.

**Immediate triage**

1. Check Control-Panel logs for upstream errors related to `KERNEL_API_URL`.
2. Verify DNS and network connectivity from Control-Panel to Kernel:

```bash
curl -v --connect-timeout 5 $KERNEL_URL/health
```

3. If mTLS is used, validate certs:

   * Check mounted client cert and key, verify expiration: `openssl x509 -in client.crt -noout -text | grep -E 'Not After'`
   * Confirm Kernel trusts CA.

**Mitigation**

* If network/DNS issue: engage networking to fix routing.
* If Kernel process is down: contact Kernel on-call to restart; use Kernel runbook.
* If mTLS failure due to cert expiry: follow Key rotation steps in `deployment.md` to renew certs, then restart Control-Panel.

**If Kernel remains unreachable**

* Mark the Control-Panel into *read-only/degraded* mode: disable state-changing UI elements (the server must support a degraded flag). Notify stakeholders.
* For emergency actions that cannot wait, escalate to Security & Kernel on-call for manual intervention.

---

## 6) Signing proxy or KMS outage — triage & mitigation

**Symptoms:** Sign requests fail; `SIGNING_PROXY_URL` returns 5xx or timeouts; KMS Sign command failing.

**Triage**

1. Check `SIGNING_PROXY_URL/health` and proxy logs.
2. Check KMS (Cloud console) for service errors or request limits.
3. Confirm `SIGNING_PROXY_API_KEY` validity and rotation.
4. Inspect Control-Panel logs for `signing` errors.

**Mitigation options**

* **Fail closed (recommended):** Block signature-required UI actions to avoid unsigned audit events. Notify ops & Security.
* **Emergency signing fallback (allowed only with Security ESSENTIAL approval):** Use an approved emergency signer (short-lived key) that is injected via Vault, and ensure public key is added to `kernel/tools/signers.json` and rolled back after incident. This is high-risk and must be recorded in audit events.

**Steps for emergency fallback**

1. Obtain Security approval.
2. Create temporary signing key and register public key in Kernel verifier registry. (Follow `kernel/tools/signers.json` format.) 
3. Configure Control-Panel with emergency signing key via Vault.
4. After incident, rotate to normal signer and deprecate temporary key.

---

## 7) SentinelNet deny / policy block — triage & mitigation

**Symptoms:** SentinelNet returns `deny` for an upgrade or apply; UI shows policy details and blocks apply.

**Triage**

1. Inspect SentinelNet verdict (Rationale & policy id shown in UI). See Reasoning Graph traces for evidence.
2. If verdict is unexpected, reproduce with same payload and check SentinelNet logs for rule evaluation.

**Mitigation**

* If policy should allow, update policy via SentinelNet `policy` flow (simulation first) and restart canary/approval flow. Follow SentinelNet change control & multisig gating for HIGH|CRITICAL policies. 
* If you must override for immediate safety, follow Emergency Ratification with explicit ratification notes and Security approval.

---

## 8) Secret compromise — immediate steps

**If you suspect a secret (session secret, Kernel token, signing key) is leaked:**

1. Immediately rotate the secret in Vault/Secret Manager. Do not store new secret in Git.
2. Revoke tokens where applicable (OIDC client secrets, signing proxy keys).
3. If signing keys are compromised: rotate signer, register new public key in Kernel verifier registry, and invalidate old key. Run audit verification. 
4. Initiate incident response, notify Security, and collect forensic logs.

---

## 9) Post-incident tasks (remediation & evidence)

1. **Capture evidence**

   * Attach Control-Panel UI screenshots, Kernel logs, audit events, Playwright test results, and runbook execution notes to the incident ticket.
2. **Audit & verification**

   * Run audit-verify across affected audit events to ensure chain integrity. (Kernel `audit-verify.js` is the canonical verifier.) 
3. **Root cause & remediation**

   * Create remediation tasks, owner, and ETA. Add to release notes if rollback or emergency apply was used.
4. **Update runbooks**

   * Document any discovered gaps and update this runbook accordingly.
5. **Sign-off**

   * Security Engineer and SRE should sign RFC for emergency actions and confirm no outstanding risks.

---

## 10) Contacts & escalation matrix

* **Control-Panel / Platform SRE on-call** — primary pager
* **Kernel on-call** — for Kernel availability / audit verification
* **Signing Proxy on-call / Security** — for signing/KMS issues
* **SentinelNet maintainers** — for policy/denial tuning
* **Security Incident Response** — for secret compromise

*(Populate specific names / phone/slack handles for your org here.)*

---

## Appendix: Useful commands & checks

```bash
# Check Control-Panel health & transport status
curl -sS https://control-panel.prod.internal/health | jq

# Check Kernel health (from a bastion with access)
curl -sS https://kernel.prod.internal/health | jq

# Query Last Audit Event for manual verify with KMS (example)
curl -sS "https://control-panel.prod.internal/api/admin/audit/last" -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Run audit verification locally (requires signers.json)
node kernel/tools/audit-verify.js -d "postgres://user:pw@db:5432/illuvrse" -s kernel/tools/signers.json
```

---

## Final notes

* Never perform server-side direct Kernel calls in production **without** Security approval and an explicit audit plan. Control-Panel proxy routes exist to preserve security guarantees.
* Keep this runbook updated after any incident or procedure change. Add references to relevant Kernel and SentinelNet runbooks where the Control-Panel steps intersect them.

---
