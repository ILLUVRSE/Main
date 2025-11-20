# Audit Export Failure Runbook

**Scope:** Failures emitting `audit_events` to S3 Object Lock archive or downstream consumers (Kafka/Snowflake).  
**Owners:** SRE + Compliance Engineering.

---

## 1. Symptoms
- Missing files in `s3://$AUDIT_BUCKET/audit/YYYY/MM/DD/`.
- `audit_export_job_failed` alert in Grafana (error rate > 1%).
- `kernel/tools/audit-verify.js` reports gaps in `prev_hash`.
- Object-Lock retention mismatch (S3 `ObjectLockConfiguration` disabled).

## 2. Immediate Containment
1. Halt destructive actions: pause retention jobs (`kubectl scale deploy/audit-retention --replicas=0`).
2. Capture failing exporter logs:
   ```bash
   kubectl logs deploy/audit-archiver --since=30m > /tmp/audit-archiver.log
   ```
3. Verify DB head hash and export pointer:
   ```sql
   SELECT id, hash, s3_object_key, s3_archived_at
   FROM audit_events
   WHERE s3_archived_at IS NULL
   ORDER BY created_at ASC
   LIMIT 25;
   ```

## 3. Diagnosis Matrix
| Symptom | Checks | Remediation |
| --- | --- | --- |
| AccessDenied | `aws s3 cp --dryrun` with export IAM role | Rotate IAM creds, confirm bucket policy trusts exporter role |
| Object Lock off | `aws s3api get-object-lock-configuration --bucket $AUDIT_BUCKET` | Enable object lock, set retention (compliance, 7y) |
| Hash gaps | Run `node kernel/tools/audit-verify.js --since "2025-02-01T00:00:00Z"` | Replay exports in-order; ensure archiver uses single writer |
| Network timeout | Ping S3 endpoints, review VPC endpoints | Fallback to regional endpoint, increase `AWS_MAX_ATTEMPTS` |

## 4. Replay Procedure
1. Identify oldest missing row via query above.
2. Run exporter manually:
   ```bash
   AWS_MAX_ATTEMPTS=5 \
   node memory-layer/service/audit/archiver.js --after-id "$AFTER_ID" --limit 500
   ```
3. Validate new object in S3 with retention:
   ```bash
   aws s3api head-object --bucket "$AUDIT_BUCKET" --key "$KEY" --query 'ObjectLockMode'
   ```
4. Update `audit_events.s3_archived_at` pointer via stored procedure or exporter success log.

## 5. Verification
- `node kernel/tools/audit-verify.js --signers kernel/tools/signers.json --limit 2000`
- Random sample object download, compare SHA256 to DB payload.
- Ensure S3 bucket replication status = `COMPLETED`.

## 6. Communication & Follow-up
- Notify Compliance and Security (#audit-trust) with summary + affected range IDs.
- Document incident in `RELEASE_CHECKLIST.md` and create Jira for automation gaps (e.g., missing alarms).
- Schedule DR test to restore sample exports into staging and rerun verifier.
