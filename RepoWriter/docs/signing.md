# RepoWriter Production Signing Model

## Purpose

This document describes the production signing model for RepoWriter:

* How RepoWriter signs manifests
* The signing-proxy contract expected by RepoWriter
* Environment variables to configure signing behavior
* Local / CI fallback behavior
* Tests and startup checks added as part of Task 1
* Recommended production deployment notes

This file is the authoritative runbook for signing-related configuration.

---

## High-level Behavior

1. **Preferred path (production):** RepoWriter calls the configured signing proxy (`SIGNING_PROXY_URL`) and expects a base64 signature and signer ID. The proxy is the canonical location of signing keys (KMS/HSM). RepoWriter never stores or uses private keys directly.

2. **Fail-closed option:** If `REQUIRE_SIGNING_PROXY=1` is set (recommended in production), RepoWriter **fails** if the signing proxy call fails or returns an invalid response. This prevents fallback to a developer HMAC signer.

3. **Dev / CI fallback:** When the signing proxy is not configured, RepoWriter falls back to a deterministic HMAC-based signer using `REPOWRITER_SIGNING_SECRET`. This is intentionally insecure and must not be used in production.

4. **Startup checks:** Startup checks fail early when essential production configuration is missing (e.g., `NODE_ENV=production` + `REQUIRE_SIGNING_PROXY=1` without `SIGNING_PROXY_URL`).

---

## Code Locations

* `RepoWriter/server/src/services/signingProxyClient.ts` — Client calling the signing proxy.
* `RepoWriter/server/kernel/sign.ts` — Main `signManifest()` logic.
* `RepoWriter/server/test/signing.unit.ts` — Tests for proxy, fallback, and fail behavior.
* `RepoWriter/server/src/startupCheck.ts` — Startup validation.
* `RepoWriter/server/.env.example` — Example environment configuration.
* `RepoWriter/server/src/index.ts` — Calls `runStartupChecks()` before server start.

---

## Environment Variables

Add to `RepoWriter/server/.env` or your production secret manager:

* **`SIGNING_PROXY_URL`** — Full proxy URL (`https://signer.prod.internal`). RepoWriter will POST to `${SIGNING_PROXY_URL}/sign`.

* **`SIGNING_PROXY_API_KEY`** (optional) — Authentication token for the signing proxy.

* **`REQUIRE_SIGNING_PROXY`** — `1` or `0`. When `1`, signing proxy errors cause hard failure. Required in production.

* **`REPOWRITER_SIGNING_SECRET`** — HMAC fallback key. Do **not** use in production.

* **`NODE_ENV`** — Standard Node environment.

---

## Signing Proxy Contract

### Request

```http
POST /sign
Content-Type: application/json
Authorization: Bearer <SIGNING_PROXY_API_KEY>

{
  "payload_b64": "<base64-encoded canonical JSON manifest>"
}
```

### Response

```json
{
  "signature_b64": "<base64-encoded signature>",
  "signer_id": "signer-identifier"
}
```

Non‑2xx responses or responses missing required fields are treated as failures. With `REQUIRE_SIGNING_PROXY=1`, the error is propagated.

---

## Local & CI Behavior

* **Local development:** If `SIGNING_PROXY_URL` is absent, RepoWriter uses the HMAC deterministic signer.
* **CI:** May use the HMAC fallback or a signing-proxy mock.
* **Production:** Must set both `SIGNING_PROXY_URL` and `REQUIRE_SIGNING_PROXY=1`. HMAC fallback must not be allowed.

---

## Startup Checks

`runStartupChecks()` validates:

* `REPO_PATH` is accessible.
* If `NODE_ENV=production` and `REQUIRE_SIGNING_PROXY=1`, then `SIGNING_PROXY_URL` must be present.
* If `SIGNING_PROXY_URL` is set, global `fetch` must exist.
* Warnings emitted for missing production OpenAI config or missing `REQUIRE_SIGNING_PROXY`.

---

## Tests

Run:

```bash
npm --prefix RepoWriter/server run test
```

Tests include:

* Successful proxy signing
* Fallback HMAC signing when allowed
* Fail‑closed behavior in production with `REQUIRE_SIGNING_PROXY=1`
* Malformed proxy response handling

In CI, either rely on HMAC fallback or use a proxy mock.

---

## Node / Fetch Compatibility

* **Node 18+** provides global `fetch` natively.
* Node <18 requires a polyfill:

```js
import { fetch } from "undici";
globalThis.fetch = fetch;
```

Startup checks will fail if `fetch` is missing when a signing proxy is configured.

---

## Security & Production Guidance

* Never commit `REPOWRITER_SIGNING_SECRET`.
* Enforce `REQUIRE_SIGNING_PROXY=1` in production.
* Preserve audit logs for signing events.
* Ensure signing proxy supports key rotation and proper network security (mTLS or strong bearer tokens + restricted ACLs).

---

## Troubleshooting

* `Global 'fetch' is not available...` → upgrade Node or add polyfill.
* `Signing proxy error` → verify:

  * Proxy is reachable
  * API key is correct
  * Response matches expected contract
* Local testing: set `REQUIRE_SIGNING_PROXY=0` to use fallback.

---

## Production Rollout Checklist

1. Deploy a KMS/HSM‑backed signing proxy implementing POST `/sign`.
2. Configure proxy credentials.
3. Set production environment variables:

   * `NODE_ENV=production`
   * `SIGNING_PROXY_URL=https://signer.prod.internal`
   * `SIGNING_PROXY_API_KEY=<secret>`
   * `REQUIRE_SIGNING_PROXY=1`
4. Start RepoWriter — startup checks should pass.
5. Run acceptance tests / smoke sign.
6. Obtain Security + Finance + Ryan sign‑off.

---

## References

* `RepoWriter/server/src/services/signingProxyClient.ts`
* `RepoWriter/server/kernel/sign.ts`
* `RepoWriter/server/src/startupCheck.ts`
* `RepoWriter/server/test/signing.unit.ts`
* `RepoWriter/server/.env.example`

