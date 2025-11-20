# IDEA Runbook — Multisig Workflow

## Goals
- Track manifest approvals, enforce 3-of-5 (configurable) policy, and recover when approvers are unavailable.

## Normal Flow
1. Submit manifest: `curl -X POST ${IDEA_API_URL}/manifests/${ID}/submit-for-signing`.
2. Request multisig: `curl -X POST ${IDEA_API_URL}/manifests/${ID}/request-multisig -d '{"approvals_required":3,"approvers":["sec-a",...]} -H x-actor-id:release'`.
3. Operators approve via Control-Panel UI or API:
   ```bash
   curl -X POST ${IDEA_API_URL}/manifests/${ID}/approvals \
     -H 'x-actor-id:sec-a' \
     -d '{"approver_id":"sec-a","decision":"approved"}'
   ```
4. Monitor status: `SELECT status, multisig_threshold FROM idea_manifests WHERE id='${ID}';`.
5. Apply once `status=multisig_complete`.

## Handling Stuck Approvals
- Query outstanding approvals:
  ```bash
  SELECT approver_id, decision, created_at
  FROM idea_manifest_approvals WHERE manifest_id='${ID}';
  ```
- Contact approvers via #security-signoff; document response time.
- Use `--approver` override (emergency) by recording a new approval with `decision:"approved"` plus `notes:"Break-glass, CISO authorization"` (requires Security + Finance signoff logged in `IDEA/signoffs/security_engineer.sig`).

## Emergency Apply (Kernel override)
1. Ensure Kernel has emitted `sentinelnet.verdict=PASS` for manifest (control-panel UI).
2. Record at least two manual approvals via `/approvals`.
3. Trigger apply with `x-actor-id:breakglass`.
4. Immediately append incident entry to `audit_events` referencing Slack ticket.

## Rejection / Rollback
- If SentinelNet flags risk, record rejection:
  ```bash
  curl -X POST ${IDEA_API_URL}/manifests/${ID}/approvals \
    -H 'x-actor-id:sec-a' -d '{"approver_id":"sec-a","decision":"rejected","notes":"needs fixes"}'
  ```
- Manifest status stays `awaiting_multisig`. Creator must submit new package + manifest.

## Metrics & Alerts
- `idea_manifest_sign_requests_total` (Prometheus) - watch for spikes.
- Alert when `multisig_pending_duration_seconds > 1800`.

## Verification Checklist
- `node kernel/tools/audit-verify.js --signers kernel/tools/signers.json`.
- `SELECT * FROM idea_publish_events WHERE manifest_id='${ID}'` after apply.
