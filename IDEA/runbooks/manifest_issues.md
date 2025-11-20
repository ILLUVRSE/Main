# IDEA Runbook — Manifest Signing Issues

Purpose: diagnose manifest creation/submission problems (failed Kernel signatures, SHA mismatches, audit gaps).

## 1. Quick checks
- `kubectl logs deploy/idea-service -n idea | grep idea.manifest` for recent events.
- `curl -fsS ${IDEA_API_URL}/health`.
- Confirm package SHA: `psql $IDEA_DATABASE_URL -c "SELECT id, status, sha256 FROM idea_packages ORDER BY updated_at DESC LIMIT 5;"`.

## 2. Kernel signature failures
1. Inspect Kernel mock/real logs for `/manifests/sign`.
2. Validate request payload:
   ```bash
   psql $IDEA_DATABASE_URL -c "SELECT manifest_signature_id, kernel_response FROM idea_manifests WHERE id='${MANIFEST_ID}'\gx"
   ```
3. Re-run signing with stricter logging:
   ```bash
   curl -X POST ${IDEA_API_URL}/manifests/${MANIFEST_ID}/submit-for-signing \
     -H 'x-actor-id: ops' -H 'content-type: application/json' -d '{}'
   ```
4. Verify signer registry matches Kernel output:
   ```bash
   node kernel/tools/audit-verify.js --signers kernel/tools/signers.json --limit 25
   ```

## 3. SHA256 mismatch during `/packages/:id/complete`
- Confirm artifact uploaded to MinIO/S3:
  ```bash
  mc stat idea-local/idea-packages/packages/${PACKAGE_ID}/artifact.tgz
  ```
- Recompute SHA via `aws s3 cp --no-sign-request`.
- Ensure `IDEA_S3_BUCKET` env matches bucket used to presign.

## 4. Audit gaps
- Query latest rows:
  ```bash
  psql $IDEA_DATABASE_URL -c "SELECT event_type, hash, prev_hash FROM audit_events ORDER BY created_at DESC LIMIT 20;"
  ```
- Run verifier: `node kernel/tools/audit-verify.js --database-url "$IDEA_DATABASE_URL" --signers kernel/tools/signers.json`.
- If signature missing, confirm `SIGNING_PROXY_URL` or `KMS_KEY_ID` configured and `REQUIRE_SIGNING_PROXY=true`.

## 5. Remediation
- Re-upload artifact, rerun `scripts/validate_package.js` before re-submission.
- Restart IDEA service after updating env secrets to reload signing proxy config.
- Document incident + outcome in `RELEASE_CHECKLIST.md`.
