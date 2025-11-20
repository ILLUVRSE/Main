#!/usr/bin/env bash
set -euo pipefail

API_URL="${IDEA_API_URL:-http://127.0.0.1:6060}"
ACTOR="${IDEA_E2E_ACTOR:-e2e-creator}"
TMP_DIR="$(mktemp -d)"
ARTIFACT="${TMP_DIR}/package.tgz"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "[idea:e2e] creating dummy package..."
echo "demo artifact $(date)" > "${ARTIFACT}"
SHA256=$(shasum -a 256 "${ARTIFACT}" | awk '{print $1}')

submit=$(curl -sS -X POST "${API_URL}/packages/submit" \
  -H "content-type: application/json" \
  -H "x-actor-id: ${ACTOR}" \
  -d '{"package_name":"e2e-multisig","version":"1.0.0","metadata":{"impact":"HIGH"}}')
package_id=$(echo "${submit}" | jq -r '.package.id')
upload_url=$(echo "${submit}" | jq -r '.upload.url')
bucket_key=$(echo "${submit}" | jq -r '.upload.bucket_key')

echo "[idea:e2e] uploading artifact via presigned URL..."
if [[ "${IDEA_E2E_DEV_UPLOAD:-0}" == "1" ]]; then
  dest="${DEV_PACKAGE_DIR:-${TMP_DIR}/dev-packages}/${bucket_key}"
  mkdir -p "$(dirname "${dest}")"
  cp "${ARTIFACT}" "${dest}"
else
  curl -sS -X PUT "${upload_url}" --data-binary "@${ARTIFACT}" >/dev/null
fi

echo "[idea:e2e] marking package complete..."
curl -sS -X POST "${API_URL}/packages/${package_id}/complete" \
  -H "content-type: application/json" \
  -H "x-actor-id: ${ACTOR}" \
  -d "{\"s3_key\":\"${bucket_key}\",\"expected_sha256\":\"${SHA256}\"}" >/dev/null

manifest=$(curl -sS -X POST "${API_URL}/manifests/create" \
  -H "content-type: application/json" \
  -H "x-actor-id: ${ACTOR}" \
  -d "{\"package_id\":\"${package_id}\",\"impact\":\"HIGH\",\"preconditions\":{\"impact\":\"HIGH\"}}")
manifest_id=$(echo "${manifest}" | jq -r '.manifest_id')

echo "[idea:e2e] requesting kernel signature..."
curl -sS -X POST "${API_URL}/manifests/${manifest_id}/submit-for-signing" \
  -H "content-type: application/json" \
  -H "x-actor-id: ${ACTOR}" \
  -d '{}' >/dev/null

echo "[idea:e2e] requesting multisig..."
curl -sS -X POST "${API_URL}/manifests/${manifest_id}/request-multisig" \
  -H "content-type: application/json" \
  -H "x-actor-id: ${ACTOR}" \
  -d '{"approvals_required":3,"approvers":["sec-1","sec-2","sec-3","sec-4","sec-5"]}' >/dev/null

approve() {
  local approver="$1"
  curl -sS -X POST "${API_URL}/manifests/${manifest_id}/approvals" \
    -H "content-type: application/json" \
    -H "x-actor-id: ${approver}" \
    -d "{\"approver_id\":\"${approver}\",\"decision\":\"approved\"}" >/dev/null
}

approve "sec-1"
approve "sec-2"
approve "sec-3"

echo "[idea:e2e] applying manifest..."
curl -sS -X POST "${API_URL}/manifests/${manifest_id}/apply" \
  -H "content-type: application/json" \
  -H "x-actor-id: ${ACTOR}" >/dev/null

echo "[idea:e2e] multisig scenario complete (manifest ${manifest_id})"
