#!/usr/bin/env bash
# devops/scripts/prepare_oidc.sh
# Idempotent Keycloak provisioning for local dev:
#  - creates realm "testrealm" (if missing)
#  - creates confidential client "kernel-client" with secret "kernel-secret"
# Usage: ./devops/scripts/prepare_oidc.sh
set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
REALM="testrealm"
CLIENT_ID="kernel-client"
CLIENT_SECRET="${CLIENT_SECRET:-kernel-secret}"

echo "== prepare_oidc.sh starting =="
echo "Keycloak URL: $KEYCLOAK_URL"
echo "Admin user: $ADMIN_USER"
echo "Realm: $REALM"
echo "Client: $CLIENT_ID"

# Wait for Keycloak to be reachable
echo "Waiting for Keycloak to be reachable at $KEYCLOAK_URL ..."
until curl -sSf "${KEYCLOAK_URL}/" >/dev/null 2>&1; do
  printf '.'
  sleep 1
done
echo ""
echo "Keycloak reachable."

# Obtain admin access token
echo "Fetching admin access token..."
TOKEN_JSON=$(curl -sS -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "grant_type=password&client_id=admin-cli&username=${ADMIN_USER}&password=${ADMIN_PASS}")

# Validate JSON
if ! printf '%s' "$TOKEN_JSON" | python3 -c "import sys,json; json.load(sys.stdin)"; then
  echo "Failed to parse token response: $TOKEN_JSON"
  exit 1
fi

ADMIN_TOKEN=$(printf '%s' "$TOKEN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
if [ -z "$ADMIN_TOKEN" ]; then
  echo "Failed to obtain admin token"
  exit 1
fi
echo "Admin token acquired."

# Helper to call admin API
kc_admin() {
  local method=$1; shift
  curl -sS -X "$method" -H "Authorization: Bearer ${ADMIN_TOKEN}" -H "Content-Type: application/json" "$@"
}

# Create realm if missing
echo "Ensuring realm '${REALM}' exists..."
RC=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${ADMIN_TOKEN}" "${KEYCLOAK_URL}/admin/realms/${REALM}" || true)
if [ "$RC" = "200" ]; then
  echo "Realm ${REALM} already exists."
else
  echo "Creating realm ${REALM}..."
  kc_admin POST "${KEYCLOAK_URL}/admin/realms" -d "$(cat <<JSON
{
  "realm": "${REALM}",
  "enabled": true
}
JSON
)"
  echo "Realm ${REALM} created."
fi

# Check if client exists; if so, delete it to ensure idempotent recreate with desired secret
echo "Checking for existing client '${CLIENT_ID}'..."
CLIENTS_JSON=$(kc_admin GET "${KEYCLOAK_URL}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}" || echo "[]")
# Use python to count
CLIENT_COUNT=$(printf '%s' "$CLIENTS_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
if [ "$CLIENT_COUNT" -gt 0 ]; then
  CLIENT_UUID=$(printf '%s' "$CLIENTS_JSON" | python3 -c "import sys,json; j=json.load(sys.stdin); print(j[0].get('id',''))")
  echo "Client '${CLIENT_ID}' exists (id=${CLIENT_UUID}); deleting to recreate."
  kc_admin DELETE "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_UUID}"
  echo "Deleted existing client."
fi

# Create confidential client with explicit secret
echo "Creating confidential client '${CLIENT_ID}' with secret '${CLIENT_SECRET}'..."
kc_admin POST "${KEYCLOAK_URL}/admin/realms/${REALM}/clients" -d "$(cat <<JSON
{
  "clientId": "${CLIENT_ID}",
  "enabled": true,
  "publicClient": false,
  "protocol": "openid-connect",
  "redirectUris": ["*"],
  "clientAuthenticatorType": "client-secret",
  "secret": "${CLIENT_SECRET}",
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": true,
  "serviceAccountsEnabled": false
}
JSON
)"
echo "Client creation request sent."

# Verify client created and show secret
sleep 1
CLIENTS_JSON=$(kc_admin GET "${KEYCLOAK_URL}/admin/realms/${REALM}/clients?clientId=${CLIENT_ID}")
CLIENT_UUID=$(printf '%s' "$CLIENTS_JSON" | python3 -c "import sys,json; j=json.load(sys.stdin); print(j[0].get('id','') if len(j)>0 else '')")
if [ -z "$CLIENT_UUID" ]; then
  echo "ERROR: client not found after creation."
  exit 1
fi

# Try to fetch client secret from admin endpoint (if supported)
echo "Fetching client secret for '${CLIENT_ID}' (client id ${CLIENT_UUID})..."
SECRET_JSON=$(kc_admin GET "${KEYCLOAK_URL}/admin/realms/${REALM}/clients/${CLIENT_UUID}/client-secret" || true)
if printf '%s' "$SECRET_JSON" | python3 -c "import sys,json; data=json.load(sys.stdin); print('value' in data)" 2>/dev/null | grep -q True; then
  CURRENT_SECRET=$(printf '%s' "$SECRET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('value'))")
  echo "Client secret is: ${CURRENT_SECRET}"
else
  # Fallback: assume we set the secret on create; report that.
  echo "Client secret (assumed): ${CLIENT_SECRET}"
fi

echo "== prepare_oidc.sh completed =="
echo "Realm: ${REALM}"
echo "Client: ${CLIENT_ID}"
echo "Client secret: ${CLIENT_SECRET}"
echo ""
echo "You can now use OIDC_ISSUER=${KEYCLOAK_URL}/realms/${REALM} and CLIENT_ID=${CLIENT_ID} with CLIENT_SECRET above."

