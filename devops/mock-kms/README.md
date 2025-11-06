# devops/mock-kms — Minimal Mock KMS

**Purpose:** simple HTTP mock KMS used by Phase 4 CI integration tests.  
It provides lightweight endpoints that return 200 and predictable JSON so readiness checks and KMS-dependent code paths can be exercised without a real KMS.

## What it exposes
- `GET /` → `{ "status": "ok" }`
- `GET /ready` → `{ "status": "ready" }`
- `GET /v1/status` → `{ "service":"mock-kms","status":"ok","ts": "..." }`
- `GET /v1/keys/:id` → `{ id, keyType: 'mock-rsa', publicKey: 'PUBLIC_KEY_FOR_<id>' }`

The service listens on container port **8080**.

## Build locally
From repo root:

```bash
# build image
docker build -t illuvrse/mock-kms:local devops/mock-kms

Run locally (host port 18080 recommended to avoid Keycloak collisions)
# run and map host port 18080 -> container 8080
docker run --rm -p 18080:8080 illuvrse/mock-kms:local

Smoke tests

In another terminal:
curl -sS http://localhost:18080/ | jq .
curl -sS http://localhost:18080/ready | jq .
curl -sS http://localhost:18080/v1/status | jq .
curl -sS http://localhost:18080/v1/keys/test-key | jq .

Expected:
{ "status": "ok" }
{ "status": "ready" }
{ "service": "mock-kms", "status": "ok", "ts": "..." }
{ "id": "test-key", "keyType": "mock-rsa", "publicKey": "PUBLIC_KEY_FOR_test-key" }

Usage in CI compose

Add a service like this to devops/docker-compose.ci.yml:
mock-kms:
  image: illuvrse/mock-kms:local
  build:
    context: devops/mock-kms
  ports:
    - "18080:8080"
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8080/ready"]
    interval: 5s
    timeout: 3s
    retries: 5

Notes

In CI you can build the image during the workflow or point to an already-published image. If you use a host port mapping in CI, ensure it does not conflict with other services. Using internal compose networking (mock-kms:8080) is preferred; CI should not rely on host port mappings.

The mock is intentionally tiny. If you need additional KMS behavior for tests (e.g., returning jwk or signing), extend server.js accordingly.

Troubleshooting

If a port is already in use on your host (e.g., Keycloak on 8080), run on a different host port (e.g., -p 18180:8080).

To inspect container logs:
docker ps
docker logs <container-id>

## Exact commands to create the file
Run from repo root:

```bash
mkdir -p devops/mock-kms
cat > devops/mock-kms/README.md <<'EOF'
# devops/mock-kms — Minimal Mock KMS

**Purpose:** simple HTTP mock KMS used by Phase 4 CI integration tests.  
It provides lightweight endpoints that return 200 and predictable JSON so readiness checks and KMS-dependent code paths can be exercised without a real KMS.

## What it exposes
- `GET /` → `{ "status": "ok" }`
- `GET /ready` → `{ "status": "ready" }`
- `GET /v1/status` → `{ "service":"mock-kms","status":"ok","ts": "..." }`
- `GET /v1/keys/:id` → `{ id, keyType: 'mock-rsa', publicKey: 'PUBLIC_KEY_FOR_<id>' }`

The service listens on container port **8080**.

## Build locally
From repo root:

```bash
# build image
docker build -t illuvrse/mock-kms:local devops/mock-kms

Run locally (host port 18080 recommended to avoid Keycloak collisions)
# run and map host port 18080 -> container 8080
docker run --rm -p 18080:8080 illuvrse/mock-kms:local

Smoke tests

In another terminal:
curl -sS http://localhost:18080/ | jq .
curl -sS http://localhost:18080/ready | jq .
curl -sS http://localhost:18080/v1/status | jq .
curl -sS http://localhost:18080/v1/keys/test-key | jq .

Expected:
{ "status": "ok" }
{ "status": "ready" }
{ "service": "mock-kms", "status": "ok", "ts": "..." }
{ "id": "test-key", "keyType": "mock-rsa", "publicKey": "PUBLIC_KEY_FOR_test-key" }

Usage in CI compose

Add a service like this to devops/docker-compose.ci.yml:
mock-kms:
  image: illuvrse/mock-kms:local
  build:
    context: devops/mock-kms
  ports:
    - "18080:8080"
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8080/ready"]
    interval: 5s
    timeout: 3s
    retries: 5

Notes

In CI you can build the image during the workflow or point to an already-published image. If you use a host port mapping in CI, ensure it does not conflict with other services. Using internal compose networking (mock-kms:8080) is preferred; CI should not rely on host port mappings.

The mock is intentionally tiny. If you need additional KMS behavior for tests (e.g., returning jwk or signing), extend server.js accordingly.

Troubleshooting

If a port is already in use on your host (e.g., Keycloak on 8080), run on a different host port (e.g., -p 18180:8080).

To inspect container logs:
docker ps
docker logs <container-id>


