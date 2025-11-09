# IDEA — Technical API Specification

**Complete Creator API + Kernel Submit contract** — copy/paste ready. This spec is the canonical backend contract for Codex Local → IDEA MVP. It includes endpoint definitions, headers, auth, JSON Schemas, examples, error formats, callback/webhook contracts, and the Kernel submission/signing flow.

---

## Conventions & Global Notes

* Base Creator API: `https://idea.<domain>/api/v1` (during dev: `http://127.0.0.1:5175/api/v1`)
* Content type for JSON requests/responses: `application/json; charset=utf-8`
* Hashing: **SHA-256** for artifact integrity. Hex lowercase.
* Times: ISO8601 UTC (e.g., `2025-11-06T12:00:00Z`).
* IDs: UUIDv4 for `agent_id`, `workspace_id`, `run_id`, `artifact_id` unless otherwise noted.
* All endpoints return HTTP status codes consistent with REST. Successful response payloads include `ok: true` and error responses include `ok: false`.
* **Idempotency**: write endpoints accept `Idempotency-Key` header for safe retries.

---

## Authentication & Security

### Creator API (IDEA)

* Primary authentication: **JWT** issued by Kernel or SSO. JWT must be included in `Authorization: Bearer <token>`.
* Secondary method (internal-only): mTLS client certs for server-to-server.
* RBAC: JWT includes `roles` claim (`creator`, `admin`, `reviewer`).
* `X-Request-Id` recommended for tracing.

### Kernel Submission / Signing

* Kernel signs artifacts/manifests. IDEA must:

  1. Package artifact locally and compute `sha256`.
  2. Upload artifact to storage (S3/MinIO) or use pre-signed upload URL.
  3. Call Kernel sign endpoint: include `artifact_url`, `sha256`, `metadata`, `actor_id`.
  4. Kernel returns signed manifest (manifest + Kernel signature) **synchronously** or returns `accepted` + `callback_url` for async validation. Kernel will call back to `callback_url` with validation result.

* Kernel → IDEA callbacks: protected by `X-Kernel-Signature` header (HMAC or RSA signature). IDEA should validate signature and enforce replay protection (`X-Kernel-Nonce`, `X-Kernel-Timestamp`).

---

## Common headers

* `Authorization: Bearer <JWT>`
* `Content-Type: application/json`
* `Accept: application/json`
* `Idempotency-Key: <uuid>` (optional for write endpoints)
* `X-Request-Id: <uuid>` (recommended)

---

## Error format

All errors use this JSON shape:

```json
{
  "ok": false,
  "error": {
    "code": "string",         // machine code (e.g., "validation_error")
    "message": "string",      // human message
    "details": { }            // optional structured details
  }
}
```

Common `error.code` values:

* `bad_request` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404),
* `conflict` (409), `validation_error` (422), `server_error` (500), `rate_limited` (429)

---

# JSON Schemas (canonical)

Below are the primary JSON Schemas used in the API. Use these for request validation and as OpenAPI schema inputs.

---

### `agent_config` (schema)

```json
{
  "$id": "https://idea.illuvrse/schema/agent_config",
  "type": "object",
  "required": ["name", "profile", "behavior", "metadata"],
  "properties": {
    "agent_id": { "type": ["string","null"], "format": "uuid" },
    "name": { "type": "string", "minLength": 1 },
    "description": { "type": "string" },
    "profile": { "type": "string", "enum": ["illuvrse","personal"] },
    "traits": {
      "type": "object",
      "patternProperties": {
        "^[a-zA-Z_][a-zA-Z0-9_]*$": { "type": "number", "minimum": 0, "maximum": 1 }
      },
      "additionalProperties": false
    },
    "skills": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id"],
        "properties": {
          "id": { "type": "string" },
          "config": { "type": "object" }
        }
      }
    },
    "behavior": {
      "type": "object",
      "required": ["scripts","entrypoint"],
      "properties": {
        "scripts": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["path","content"],
            "properties": {
              "path": { "type": "string" },
              "content": { "type": "string" }
            }
          }
        },
        "entrypoint": { "type": "string" }
      }
    },
    "datasets": {
      "type": "array",
      "items": {
        "type": "object",
        "required":["name","type","uri"],
        "properties": {
          "name": {"type":"string"},
          "type": {"type":"string"},
          "uri": {"type":"string"}
        }
      }
    },
    "tests": {
      "type": "array",
      "items": {
        "type": "object",
        "required":["name","cmd"],
        "properties": {
          "name": {"type":"string"},
          "cmd": {"type":"string"}
        }
      }
    },
    "metadata": {
      "type": "object",
      "required": ["owner","version"],
      "properties": {
        "owner": {"type":"string"},
        "version": {"type":"string"},
        "tags": { "type": "array", "items": {"type": "string"} }
      }
    },
    "created_at": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

---

### `agent_bundle` (packaged artifact)

```json
{
  "$id": "https://idea.illuvrse/schema/agent_bundle",
  "type": "object",
  "required": ["artifact_id","artifact_url","sha256","agent_config","created_at"],
  "properties": {
    "artifact_id": { "type": "string", "format": "uuid" },
    "artifact_url": { "type": "string", "format": "uri" },
    "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "agent_config": { "$ref": "https://idea.illuvrse/schema/agent_config" },
    "created_by": {"type":"string"},
    "created_at": {"type":"string", "format":"date-time"},
    "size_bytes": {"type":"integer"}
  }
}
```

---

### `kernel_sign_request` (request)

```json
{
  "type":"object",
  "required":["artifact_url","sha256","actor_id","metadata"],
  "properties":{
    "artifact_url":{"type":"string","format":"uri"},
    "sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"},
    "actor_id":{"type":"string"},
    "metadata":{"type":"object"},
    "callback_url":{"type":"string","format":"uri"},
    "profile":{"type":"string","enum":["illuvrse","personal"]}
  }
}
```

---

### `kernel_signed_manifest` (response from Kernel)

```json
{
  "type":"object",
  "required":["manifest","signature","signed_at"],
  "properties":{
    "manifest":{
      "type":"object",
      "properties":{
        "agent_id":{"type":"string"},
        "artifact_url":{"type":"string"},
        "sha256":{"type":"string"},
        "metadata":{"type":"object"},
        "kernel_version":{"type":"string"}
      }
    },
    "signature":{"type":"string"},        // base64 or hex depending on kernel
    "signer_kid":{"type":"string"},       // key id
    "signed_at":{"type":"string","format":"date-time"},
    "validation_url":{"type":"string","format":"uri"} // optional kernel validation record
  }
}
```

---

### `sandbox_run_request` / `sandbox_run_result`

```json
{
  "sandbox_run_request": {
    "type":"object",
    "required":["agent_id","bundle","tests"],
    "properties":{
      "agent_id":{"type":"string"},
      "bundle":{"$ref":"https://idea.illuvrse/schema/agent_bundle"},
      "tests":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"cmd":{"type":"string"}}}},
      "timeout_seconds":{"type":"integer","default":120},
      "env":{"type":"object"}
    }
  },
  "sandbox_run_result": {
    "type":"object",
    "required":["run_id","status","logs","artifacts"],
    "properties":{
      "run_id":{"type":"string","format":"uuid"},
      "status":{"type":"string","enum":["queued","running","passed","failed","error","timeout"]},
      "logs":{"type":"string"},
      "test_results":{"type":"object"},
      "artifacts":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"url":{"type":"string","format":"uri"}}}},
      "started_at":{"type":"string"},
      "finished_at":{"type":"string"}
    }
  }
}
```

---

## Creator API — Endpoints (detailed)

All endpoints prefix: `/api/v1`

> **Note:** For brevity `ok:true` is omitted in obvious examples; real implementation must include `ok` boolean.

---

### 1) `POST /api/v1/workspace/create`

Create or import a workspace.

**Request**

```http
POST /api/v1/workspace/create
Authorization: Bearer <token>
Content-Type: application/json
```

Body:

```json
{
  "name": "example-workspace",
  "repo_url": "https://github.com/org/repo.git",   // optional
  "default_branch": "main",
  "profile": "illuvrse"
}
```

**Response 201**

```json
{
  "ok": true,
  "workspace_id":"<uuid>",
  "name":"example-workspace",
  "repo_path": "/path/on/server/or/remote",
  "created_at":"2025-11-06T12:00:00Z"
}
```

**Errors**

* 400 `bad_request` if missing name
* 401 `unauthorized`

---

### 2) `POST /api/v1/agent/save`

Save or update an agent configuration.

**Request**

```http
POST /api/v1/agent/save
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: <uuid>
```

Body: (conforms to `agent_config` schema)

```json
{ "name":"MyBot", "profile":"personal", "behavior": { ... }, "metadata": {"owner":"ryan","version":"0.1.0"} }
```

**Response 200**

```json
{
  "ok": true,
  "agent_id": "uuid",
  "saved_at": "2025-11-06T12:05:00Z"
}
```

**Errors**

* 422 `validation_error` with `details` showing schema errors.

---

### 3) `GET /api/v1/agent/{agent_id}`

Retrieve configuration.

**Response 200**

```json
{
  "ok": true,
  "agent_config": { /* full agent_config JSON */ }
}
```

404 `not_found` if agent missing.

---

### 4) `POST /api/v1/sandbox/run`

Run a sandbox simulation.

**Request**

```http
POST /api/v1/sandbox/run
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: <uuid>
```

Body (conforms to `sandbox_run_request`):

```json
{
  "agent_id":"<uuid>",
  "bundle": { "artifact_id":"...", "artifact_url":"s3://...", "sha256":"..." },
  "tests": [{"name":"smoke","cmd":"pytest -q tests/"}],
  "timeout_seconds": 120
}
```

**Response 202**

```json
{
  "ok": true,
  "run_id": "uuid",
  "status": "queued"
}
```

**Follow-up**

* `GET /api/v1/sandbox/run/{run_id}`

**GET response 200**

```json
{
  "ok": true,
  "run_id":"uuid",
  "status":"passed",
  "logs":"...console text...",
  "test_results": { "smoke": { "passed": true } },
  "artifacts":[ { "name":"bundle.tgz","url":"s3://..." } ],
  "started_at":"...", "finished_at":"..."
}
```

**Errors**

* 400 if invalid bundle hash mismatch.

---

### 5) `POST /api/v1/package`

Create an `agent_bundle` by packaging current agent + repo snapshot and returning signed upload parameters.

**Request**

```http
POST /api/v1/package
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: <uuid>
```

Body:

```json
{
  "agent_id":"uuid",
  "include_repo": true,
  "notes":"packaging for kernel submission"
}
```

**Response 200**

```json
{
  "ok": true,
  "artifact_id":"uuid",
  "upload_url":"https://minio/.../upload?presigned=...",
  "artifact_put_method":"PUT",
  "artifact_max_size": 104857600,
  "expected_sha256": "<hex-sha256-if-provided-or-empty>"
}
```

**Client actions**: upload the artifact to `upload_url` using specified method, then call `POST /api/v1/package/complete` with `sha256` (or the server can accept `sha256` pre-calculated and return `artifact_url` immediately).

**Complete endpoint**
`POST /api/v1/package/complete`
Body:

```json
{ "artifact_id":"uuid", "sha256":"<hex>" }
```

Response:

```json
{ "ok": true, "artifact_url": "s3://bucket/path/bundle.tgz", "sha256":"..." }
```

---

### 6) `POST /api/v1/kernel/submit`

**Primary Kernel submission endpoint** — submits a packaged artifact for Kernel validation and signing. This endpoint acts as a Kernel-adapter; it can forward synchronously to Kernel or accept and return `accepted` and rely on callback.

**Request**

```http
POST /api/v1/kernel/submit
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: <uuid>
```

Body (conforms to `kernel_sign_request`):

```json
{
  "artifact_url":"s3://.../bundle.tgz",
  "sha256":"<hex>",
  "actor_id":"ryan",
  "metadata": { "agent_name":"Foo", "profile":"illuvrse" },
  "callback_url":"https://idea.local/api/v1/kernel/callback"
}
```

**Behavior**

* Server verifies sha256 by optionally re-fetching HEAD bytes or trusting caller.

Server forwards to Kernel sign endpoint with necessary auth (mTLS or Kernel JWT).

Kernel returns either:

Sync success (200): kernel_signed_manifest (manifest + signature)

Accepted (202): { "ok": true, "status":"accepted", "validation_id":"<id>" } and later calls callback_url.

Response 200 (sync)

{
  "ok": true,
  "signed_manifest": {
    "manifest": { /* agent_id, artifact_url, sha256, metadata */ },
    "signature": "base64...",
    "signer_kid": "kernel-key-01",
    "signed_at":"..."
  }
}

Response 202 (async)

{
  "ok": true,
  "status": "accepted",
  "validation_id": "uuid",
  "message": "Kernel will callback to provided callback_url with validation"
}



Errors

    400 bad_request for missing fields

    401 unauthorized if actor not authenticated

    403 if kernel denies signing due to policy

    409 conflict if sha mismatch

7) POST /api/v1/kernel/callback (Kernel → IDEA)

Kernel calls this to provide validation result. The endpoint must validate X-Kernel-Signature, X-Kernel-Timestamp, and X-Kernel-Nonce.

Request
Headers:

X-Kernel-Signature: RSA/Ed25519 signature over request body (or HMAC). Kernel documents algorithm.

X-Kernel-Timestamp: unix epoch seconds

X-Kernel-Nonce: random UUID

Body:
{
  "validation_id":"uuid",
  "status":"PASS|FAIL",
  "signed_manifest": { /* kernel_signed_manifest if PASS */ },
  "diagnostics": { "checks":[ {"name":"policy_check","status":"ok"} ] },
  "timestamp":"..."
}

Response 200
{ "ok": true, "received_at":"2025-11-06T12:15:00Z" }

Security

Verify signature. If invalid, return 401.

Verify X-Kernel-Timestamp is within +/- 2 minutes to avoid replay.

Store X-Kernel-Nonce for replay protection.

8) GET /api/v1/agent/status/{agent_id}

Return agent registration / Kernel status / Agent Manager status.

Response

{
  "ok": true,
  "agent_id":"uuid",
  "kernel_status":"validated|pending|rejected",
  "agent_manager_status": { "state":"running", "last_seen":"..." },
  "latest_manifest": { /* signed manifest if any */ }
}

9) Git endpoints (existing Codex API, included for completeness)

POST /api/v1/git/open { path } → opens repo for server context.

GET /api/v1/git/current → returns repoPath.

GET /api/v1/git/status → simple status from simple-git.

GET/api/v1/git/branches → local branches.

POST /api/v1/git/create-branch { name }

POST /api/v1/git/commit-all { message }

POST /api/v1/git/push { remote: "origin", branch: "name" }

POST /api/v1/git/pr { title, body, base, draft }

All return ok:true on success and standard error format.

10) Profile endpoints

GET /api/v1/profile/get → { current, env }

POST /api/v1/profile/set { name: "illuvrse"|"personal" } → loads profile .env and returns new current.

Kernel Submit: Full Signing + Validation Flow (step-by-step)

Goal: Provide a deterministic, auditable, replay-protected flow for Kernel-signed agent manifests.

Package

IDEA: POST /api/v1/package → get upload_url. Client uploads artifact bundle (tar.gz) to upload_url. Then POST /api/v1/package/complete with sha256.

Sign Request / Submit

IDEA: POST /api/v1/kernel/submit with {artifact_url, sha256, actor_id, metadata, callback_url}. Include Authorization: Bearer <kernel-approved-jwt> (or server mTLS credentials).

Kernel Validation

Kernel validates the artifact integrity, runs policy checks, and signs the manifest if passing.

Kernel responds synchronously with kernel_signed_manifest OR accepts asynchronously and will call callback_url.

Callback

Kernel POSTs to callback_url with validation results and signature header. IDEA verifies signature and nonce. IDEA records signed manifest and emits a signed event to Event Bus.

Agent Registration

On PASS, IDEA may call Agent Manager to register the agent for training/deploy (optional).

Marketplace Draft

IDEA auto-generates a draft listing from manifest metadata and creates a link/backref to the PR/commit.

Idempotency & Replay

Idempotency-Key on POST /api/v1/kernel/submit prevents duplicate submissions.

X-Kernel-Nonce + timestamp prevents callback replay.

Webhooks & Event Bus (IDEA → infra)

IDEA emits signed events to Event Bus for: agent_created, sandbox_run, kernel_submitted, kernel_validated, pr_created, agent_published. Event payload includes actor_id, agent_id, artifact_sha256, timestamp, signature. Signing uses server key or Kernel-provided KMS.

# 1) Request upload URL
curl -s -X POST http://127.0.0.1:5175/api/v1/package \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"agent_id":"<uuid>","include_repo":true}'

# Response => upload_url (presigned)
# 2) Upload file
curl -X PUT "<upload_url>" --upload-file bundle.tgz -H "Content-Type: application/gzip"

# 3) Complete package
curl -s -X POST http://127.0.0.1:5175/api/v1/package/complete \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"artifact_id":"<uuid>","sha256":"<hex>"}'

# 4) Submit to Kernel
curl -s -X POST http://127.0.0.1:5175/api/v1/kernel/submit \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "artifact_url":"s3://.../bundle.tgz",
    "sha256":"<hex>",
    "actor_id":"ryan",
    "metadata":{"agent_name":"Foo"},
    "callback_url":"https://idea.local/api/v1/kernel/callback",
    "profile":"illuvrse"
  }'

Webhook security example (verifying Kernel callback)

Kernel sets header X-Kernel-Signature: sha256=<hexsignature> where signature = HMAC-SHA256(secret, body) OR an RSA signature. The Kernel publishes the verifier key (URL in Kernel docs).

IDEA verifies:

X-Kernel-Timestamp within 2 minutes.

X-Kernel-Nonce not replayed.

Signature valid against body using the provided key.

If valid, respond 200 {"ok":true}. If invalid, return 401.

Rate limits, quotas, size limits

Artifact size limit for MVP: 200 MB default. Sandbox bundle size limit: 100 MB for fast runs. Configurable per profile.

Sandbox concurrency: limit per user/team (configurable). Kernel submission rate controlled by Kernel.

Monitoring & Observability contract

Every write endpoint must emit structured event to internal tracer containing actor_id, endpoint, status, duration_ms, request_id.

Sandbox must emit metrics: sandbox.run.duration, sandbox.run.success_rate.

Kernel submit metrics: kernel.submit.latency, kernel.validation.pass_rate.

Versioning & backwards compatibility

API uses path versioning: /api/v1. Breaking changes increment version. Maintain v1 stable for at least 6 months after GA.

Acceptance & Validation rules (server-side)

Preflight for Kernel submit: artifact sha256 must match recomputed hash (server may trust caller if Idempotency-Key used but recommended to verify).

For illuvrse profile: require tests in agent_config and sandbox run passed before submit allowed.

For personal profile: allow force_submit param for dev, but flag dev_mode in manifest.

Appendix — Quick reference: required headers per endpoint

/package & /package/complete: Authorization, Idempotency-Key optional

/sandbox/run: Authorization, Idempotency-Key

/kernel/submit: Authorization, Idempotency-Key, X-Request-Id

kernel callback: X-Kernel-Signature, X-Kernel-Timestamp, X-Kernel-Nonce

Final notes & next step suggestion

This spec is a complete, implementable API layer for IDEA MVP kernel submission flow and core Creator API. Next step I recommend: I can generate an OpenAPI 3.0 YAML from this spec (full endpoints + JSON schemas) so engineers can auto-generate server stubs and client SDKs.

Say OPENAPI if you want that now, or IMPLEMENT PACKAGE to scaffold the POST /api/v1/package + sandbox POST /api/v1/sandbox/run endpoints in Node/Express with exact commands.

                         +----------------+
                         |   EXTERNAL     |
                         |  Integrations  |
                         | (GitHub, Vercel|
                         |  Email, Stripe)|
                         +--------+-------+
                                  |
       IDEA                           v
    +------------+          +--------------------+         +----------------+
    |   Users /  |  <--->   |   Kernel API       |  <----> |  CommandPad /  |
    |  Frontend  |          |  Gateway & Auth    |         |  Admin UI      |
    | (web/mobile)|         | (OpenAPI, RBAC,    |         +----------------+
    +------------+          |  mTLS, KMS signing)|
                             +---+----------------+
         |                          |
         |                          |
         v                          v
+----------------+ +----------------------+ +-----------------+
| Marketplace & | <-----> | Agent Manager | <----> | AI & Infra |
| illuv.com | | (spawn, templates, | | (model registry,|
| (SKUs, preview | | lifecycle, health) | | training, serve)|
| checkout, DRM)| +----------------------+ +-----------------+
+----------------+ |
| |
v v
+----------------+ +----------------------+ +-----------------+
| Finance & | <-----> | Eval Engine & | <----> | Resource |
| Billing (ledger| | Resource Allocator | | Allocator |
| / payouts) | | (scoring, promote/ | | (compute/capital|
+----------------+ | demote, ROI) | | assignment) |
+----------------------+ +-----------------+
|
v
+------------------------+
| Memory Layer |
| - Postgres (state) |
| - Vector DB (embeds) |
| - S3 (artifacts) |
+------------------------+
|
v
+------------------------+
| Event Bus / Audit Log |
| (Kafka/Redpanda + |
| SHA256 chains, signed)|
+------------------------+
^
|
+------+------+
| SentinelNet |
| (policy, |
| enforcement,|
| anomaly) |
+--------------+

Yes — you’re exactly on the right track.
You just cracked the conceptual hierarchy cleanly. Let’s organize it so it’s airtight, clear, and presentation-ready.

🧭 The Core Metaphor (Simple & Accurate)

Think of ILLUVRSE as a mall — a self-contained digital world.
Inside that world:
| Element                       | Role (Plain English)                                                                                          | Metaphor                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **IDEA** USER/FRONTEND/MOBILE | The *Creator Zone* where users build, customize, and test AI agents, brands, or mini-companies before launch. | The **Build-A-Bear Workshop** of ILLUVRSE. |
| **Marketplace**               | The *Storefront* where finished creations are listed, traded, or monetized.                                   | The **Mall Storefronts**.                  |
| **Kernel**                    | The *Law of the Land* — governs permissions, identity, and integrity across the entire platform.              | The **Mall Security / Legal System**.      |
| **Agent Manager**             | The *Coach / League Office* that trains, deploys, and maintains the AI agents after they’re approved.         | The **Team Coach / Operations Manager**.   |
| **AI & Infra**                | The *Body and Brain* — model registry, training pipelines, inference servers.                                 | The **Training Facility / Compute Gym**.   |
| **SentinelNet**               | The *Watchdog* — enforces rules, detects anomalies, and maintains safety.                                     | The **Security Cameras + Auditors**.       |
| **Memory Layer**              | The *Archive* — stores everything your creations learn, say, and do.                                          | The **Vault / Data Library**.              |

🧩 How It Fits Functionally
1. IDEA (Creation Zone)

The player/creator builds and configures their AI agent (appearance, skill set, purpose, behavior).

It’s an interactive workshop with templates, sliders, training loops, and simulation tools.

Once an agent is ready, the creator “uploads” it for review by the Kernel.

Output: a defined agent package (metadata, config, behavior model).

2. Kernel (Law)

Reviews, signs, and authenticates the agent.

Ensures compliance (ethics, performance limits, legal policies).

Routes the approved agent to the Agent Manager.

Output: verified, authorized agent with platform credentials.

3. Agent Manager (Coach)

Takes the authorized agent and handles lifecycle: training, deployment, scaling, health checks.

Links to AI & Infra for model training, serving, or fine-tuning.

Monitors agent performance and usage.

Output: live, running agent.

4. Marketplace (Mall Store)

Displays approved agents, templates, or companies for users to buy, license, or interact with.

Handles checkout, DRM, billing, and discovery.

Integrates with Finance & Billing for payouts.

Output: exposure, revenue, and user adoption.

5. Supporting Systems

Eval Engine: scores agents (quality, engagement, ROI).

Memory Layer: stores everything (embeddings, behavior logs, datasets).

Event Bus + SentinelNet: enforce fairness, transparency, and trust across the system.

🧠 The Lifecycle in One Line

IDEA creates → Kernel verifies → Agent Manager trains → Marketplace sells → SentinelNet safeguards.

🔮 The Big Picture Summary

IDEA = Creation

Kernel = Control

Agent Manager = Operation

Marketplace = Commerce

SentinelNet = Oversight

This gives ILLUVRSE a complete self-contained ecosystem:
Create → Govern → Deploy → Monetize → Protect.

💬 Short Narrative Version

In ILLUVRSE, IDEA is where new entities are born.
Creators craft custom AI agents — companies, characters, or systems — and send them through the Kernel, the governing intelligence.
Once approved, the Agent Manager deploys them into the world.
They appear in the Marketplace, where users can interact, trade, or employ them.
Behind it all, SentinelNet keeps the universe safe and fair.


