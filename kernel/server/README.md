# Kernel Runtime Server

Implements the Kernel API in `kernel/openapi.yaml` with OpenAPI request validation, mTLS/OIDC guards, and audit emission.

## Getting started

```bash
# install dependencies
npm ci

# build and start
npm run build
POSTGRES_URL=postgres://user:pass@localhost:5432/kernel npm start

# dev server (no TLS, skips mTLS)
DEV_SKIP_MTLS=true npm run dev
```

## Tests

```bash
npm ci
npm test
```

## Production notes

- `NODE_ENV=production` or `REQUIRE_KMS=true` requires a signing backend (KMS or signing proxy) and refuses to start if misconfigured.
- mTLS is required unless `DEV_SKIP_MTLS=true` is set; startup fails in production when skip is enabled.
- `POSTGRES_URL` must point to the Kernel database. The initial schema is in `kernel/sql/migrations/0001_init.sql`.
