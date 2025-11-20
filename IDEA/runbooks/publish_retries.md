# IDEA Runbook — Publish Retries & DLQ

## Symptoms
- `/publish/notify` returning 5xx.
- Orders stuck without delivery proof (Marketplace dashboards).
- DLQ backlog (`idea_publish_events` rows not consumed).

## Retry Strategy
1. Retrieve failed publish payload:
   ```bash
   SELECT * FROM idea_publish_events
   WHERE manifest_id='${MANIFEST_ID}'
   ORDER BY created_at DESC LIMIT 1;
   ```
2. Requeue via script:
   ```bash
   curl -X POST ${IDEA_API_URL}/publish/notify \
     -H 'x-actor-id:ops' \
     -d @payload.json
   ```
   Ensure `payload.json` contains `mode`, `artifact_url`, `delivery_proof`, `key_metadata`.
3. If downstream (Marketplace or Finance) unavailable, pause retries and page on-call.

## DLQ Processing
- View DLQ table (if configured) or use `publish_events` table with `processed=false`.
- Mark success after downstream ack:
  ```bash
  UPDATE idea_publish_events SET payload = jsonb_set(payload,'{processed}', 'true'::jsonb)
  WHERE id='${EVENT_ID}';
  ```
- Keep audit trail—each retry emits `idea.publish.completed`.

## Idempotency
- Use `delivery_proof.delivery_id` as idempotency key when replaying.
- Marketplace expects same delivery proof hash; verify via:
  ```bash
  curl ${MARKETPLACE_API_URL}/internal/orders/${ORDER_ID}/deliveries
  ```

## Troubleshooting
- Check MinIO for encrypted artifact: `mc ls idea-local/idea-packages`.
- Ensure chosen mode matches encryption path:
  - `buyer-managed`: `key_metadata.buyer_public_key` must exist.
  - `marketplace-managed`: ensure `SIGNING_PROXY_URL` reachable for ephemeral key.
- Verify S3 Object Lock:
  ```bash
  aws s3api head-object --bucket "$AUDIT_BUCKET" --key "publish/${EVENT_ID}.json" --query 'ObjectLockMode'
  ```

## Escalation
- After 3 failed attempts, escalate to Security + Finance and document in `RELEASE_CHECKLIST.md`.
- Use `sre/runbooks/audit_export_failure.md` if audit archive missing.
