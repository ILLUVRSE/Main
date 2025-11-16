# Memory Layer Deployment, Security, and Operations Specification

0. Summary / Intent

Memory Layer is a multi-store service (Postgres + Vector DB + S3) that must guarantee:

* Atomic, signed audit events for every state change (no unsigned rows in production).
* Auditable provenance (hash, prev_hash, signature, manifestSignatureId).
* Immutable audit archive (S3 Object Lock) and verification tooling.
* Idempotent, reliable vector pipeline with queue fallback.
* TTL / legal-hold semantics and signed deletion audit events.
* RBAC, PII redaction, observability, and documented operational runbook.

---

## 1) Required cloud components & names (exact)

* **Postgres** (>=14) with PITR + WAL archiving.

  * Connection string: `DATABASE_URL` (e.g., `postgresql://user:pass@host:5432/illuvrse`)

* **Vector DB**

  * Provider choices: `pgvector`, `milvus`, `pinecone`, etc.
  * Environment variables:

    * `VECTOR_DB_PROVIDER` — `postgres` | `milvus` | `pinecone` | ...
    * `VECTOR_DB_ENDPOINT` — (if required)
    * `VECTOR_DB_API_KEY` — (if required)
    * `VECTOR_DB_NAMESPACE` — default `kernel-memory`

* **Object storage (S3-compatible)**:

  * Primary artifact bucket: `illuvrse-memory-${ENV}`
  * Audit archive bucket (COMPLIANCE/immutable): `illuvrse-audit-archive-${ENV}` (Object Lock COMPLIANCE, versioning ON)
  * Environment variables:

    * `S3_ENDPOINT` (optional for MinIO)
    * `S3_REGION` (optional)
    * `S3_ACCESS_KEY`, `S3_SECRET` (or IAM)

* **Audit Signing** (KMS preferred)

  * Preferred: AWS KMS key (HMAC or asymmetric).

    * `AUDIT_SIGNING_KMS_KEY_ID`
    * Ensure `AWS_REGION` and IAM credentials.
  * Alternative: Signing proxy (HSM / centralized signer).

    * `SIGNING_PROXY_URL`
    * `SIGNING_PROXY_API_KEY`
  * Emergency fallback: local key:

    * `AUDIT_SIGNING_KEY` or `AUDIT_SIGNING_PRIVATE_KEY` or `AUDIT_SIGNING_SECRET`
  * Enforcement:

    * `REQUIRE_KMS=true` or `NODE_ENV=production` requires a signer.

* **Secrets manager**

  * Use Vault / cloud secret manager.
  * Recommended secret names:

    * `memory-layer/database-url` → `DATABASE_URL`
    * `memory-layer/s3-access-key` → `S3_ACCESS_KEY`
    * `memory-layer/s3-secret` → `S3_SECRET`
    * `memory-layer/audit/kms-key-id` → `AUDIT_SIGNING_KMS_KEY_ID`
    * `memory-layer/signing-proxy-api-key` → `SIGNING_PROXY_API_KEY`
    * `memory-layer/vector/api-key` → `VECTOR_DB_API_KEY`
    * `memory-layer/audit/public-key` → `AUDIT_SIGNING_PUBLIC_KEY`

---

## 2) Required environment variables (exact)

**Runtime minimum**:

```
NODE_ENV=production
PORT=4300
DATABASE_URL=postgresql://...
REQUIRE_KMS=true
VECTOR_DB_PROVIDER=postgres|milvus|pinecone
VECTOR_DB_NAMESPACE=kernel-memory
S3_ENDPOINT=...
S3_REGION=...
S3_ACCESS_KEY=...
S3_SECRET=...
AUDIT_SIGNING_KMS_KEY_ID=arn:...
SIGNING_PROXY_URL=...
AUDIT_SIGNING_KEY=...
OPENAPI_SPEC_PATH=/app/dist/memory-layer/api/openapi.yaml
```

**Optional**:

```
VECTOR_WRITE_QUEUE=true
VECTOR_WORKER_INTERVAL_MS=5000
TTL_CLEANER_INTERVAL_MS=60000
MEMORY_METRICS_ENABLED=true
MEMORY_TRACING_ENABLED=true
```

---

## 3) Docker build & OpenAPI inclusion (exact)

```dockerfile
COPY memory-layer/api/openapi.yaml ./dist/memory-layer/api/openapi.yaml
ENV OPENAPI_SPEC_PATH=/app/dist/memory-layer/api/openapi.yaml
```

---

## 4) Migrations & local CI

Run migrations:

```bash
DATABASE_URL=postgresql://... npx ts-node memory-layer/scripts/runMigrations.ts memory-layer/sql/migrations
```

CI order:

1. `npm ci`
2. `npm run memory-layer:build`
3. Run migrations
4. Start test signer (`mock-kms` or proxy) with `REQUIRE_KMS=true`
5. Start server
6. Run integration tests
7. Run audit verify tool

---

## 5) KMS / Signing: exact behavior & policies

**Signing semantics:**

* Signs precomputed SHA-256 digest.
* Use `signAuditDigest(digestHex)`.

**IAM policy**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["kms:Sign","kms:Verify","kms:GenerateMac","kms:VerifyMac"],
      "Resource": "arn:aws:kms:REGION:ACCOUNT_ID:key/YOUR_KEY_ID"
    }
  ]
}
```

**Signing proxy:** mTLS + API key. Expose `/sign/hash`, `/verify`.

---

## 6) S3 audit archive & IAM policy (exact)

Bucket: `illuvrse-audit-archive-${ENV}`

Policy:

```json
{
  "Version":"2012-10-17",
  "Statement":[
    {"Sid":"AllowMemoryLayerWrite","Effect":"Allow","Principal":{"AWS":"arn:aws:iam::ACCOUNT:role/memory-layer-writer"},"Action":["s3:PutObject","s3:GetObject","s3:PutObjectLegalHold"],"Resource":["arn:aws:s3:::illuvrse-audit-archive-${ENV}/*"]},
    {"Sid":"DenyDeleteUnlessAuditAdminMFA","Effect":"Deny","Principal":"*","Action":["s3:DeleteObject","s3:DeleteObjectVersion"],"Resource":["arn:aws:s3:::illuvrse-audit-archive-${ENV}/*"],"Condition":{"StringNotEquals":{"aws:PrincipalArn":"arn:aws:iam::ACCOUNT:role/audit-admin"}}}
  ]
}
```

Object Lock: COMPLIANCE mode.

---

## 7) Secrets / Vault exact recipe

Recommended: Vault Agent Injector.

Example annotation snippet:

```yaml
vault.hashicorp.com/agent-inject: "true"
vault.hashicorp.com/role: "memory-layer-role"
vault.hashicorp.com/agent-inject-secret-DATABASE_URL: "secret/data/memory-layer/database#DATABASE_URL"
```

---

## 8) Healthchecks & readiness

Endpoints:

* `/healthz`
* `/readyz`

K8s probes:

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 4300
readinessProbe:
  httpGet:
    path: /readyz
    port: 4300
```

---

## 9) Observability & SLOs

**Metrics:**

* `memory_search_seconds`
* `memory_vector_write_seconds`
* `memory_vector_queue_depth`
* `memory_audit_sign_failures_total`
* `memory_ingestion_total`
* `memory_ttl_cleaner_processed_total`

**Tracing:** OpenTelemetry via OTLP.

---

## 10) Backup & DR

**Postgres:** WAL archiving + restore drills.
**Vector DB:** Nightly snapshots.
**Audit archive DR drill:** restore object → verify → replay.

---

## 11) Operational runbook – incidents

**Audit signing failure:** check signer, KMS, proxy.

**Vector provider outage:** inspect queue, run worker.

**S3 issues:** ensure Object Lock; test replay.

**TTL cleaner issues:** inspect metadata + audit events.

---

## 12) Governance & sign-off

Canonical payload:

```json
{
  "approver": "Ryan Lueckenotte",
  "role": "SuperAdmin",
  "module": "memory-layer",
  "approved_at": "2025-XX-XXTXX:XX:XXZ",
  "notes": "Production acceptance: migrations applied, audit signing configured, vector provider active, TTL/DR tests green"
}
```

Use signed audit event for final approval.

---

## 13) Example Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: memory-layer
spec:
  replicas: 3
  selector:
    matchLabels:
      app: memory-layer
  template:
    metadata:
      labels:
        app: memory-layer
    spec:
      containers:
        - name: memory-layer
          image: illuvrse/memory-layer:prod
          env:
            - name: NODE_ENV
              value: "production"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: memory-layer-secrets
                  key: DATABASE_URL
            - name: AUDIT_SIGNING

```

