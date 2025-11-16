````md
# RepoWriter — Production Runbook (complete)

This document is the authoritative production runbook for **RepoWriter**. It describes the required configuration, build/run procedures, deployment options (systemd and Kubernetes), operational runbooks, security hardening, monitoring & SLOs, backup/DR, and the final acceptance checklist.

**Target audience:** SRE/DevOps, Security, Release Manager.

---

## Table of contents

- Goals & assumptions
- Required production environment variables (summary)
- Build & packaging
- Deploy options
  - Systemd / VM
  - Docker Compose (example)
  - Kubernetes (example)
- Secrets, KMS & signing proxy
- Logging, metrics & alerting
- Health, readiness & SLOs
- Backups, audit retention & DR
- Key security controls & reviews
- Rollout checklist & acceptance tests
- Troubleshooting & diagnostics

---

## Goals & assumptions

- RepoWriter must run without storing private signing keys. All production signing must be performed via a signing proxy backed by KMS/HSM.
- Production must be **fail-closed** with respect to signing: `REQUIRE_SIGNING_PROXY=1`.
- Services must be observable, auditable, and recoverable.
- RepoWriter is built to `RepoWriter/server/dist/index.js` for production and should be run from that artifact.
- The operation model supports both VM/systemd and Kubernetes deployment.

---

## Required production environment variables (summary)

Below are the minimal envs required in production. Place them in your secret manager (Vault, AWS Secrets Manager, GCP Secret Manager, etc.) — never store them in git.

### Mandatory (production)
- `NODE_ENV=production`
- `PORT` (e.g., `7071`)
- `REPO_PATH` — absolute path to the repository root **or** a writable repo home for ephemeral operations
- `SIGNING_PROXY_URL` — e.g., `https://signer.prod.internal`
- `SIGNING_PROXY_API_KEY` — secret bearer token for signing proxy
- `REQUIRE_SIGNING_PROXY=1` — enforces fail-closed signing
- `TELEMETRY_ENDPOINT` — your metrics/audit endpoint (e.g., prometheus push gateway or audit collector)

### Recommended / depending on role
- `AUDIT_STORE_URL` — where to publish signed audit events
- `OPENAI_API_URL` and `OPENAI_API_KEY` — if RepoWriter uses OpenAI in production
- `SENTRY_DSN` — error reporting (optional)
- `LOG_LEVEL=info` (or `debug` for short debugging window)
- `REPOWRITER_SIGNING_SECRET` — only for dev/CI fallback. **Do NOT use in production**.

---

## Build & packaging

**Developer machine / CI**:

1. Install dependencies:
   ```bash
   npm --prefix RepoWriter/server ci
````

2. Type-check and build:

   ```bash
   npm --prefix RepoWriter/server exec -- tsc -p RepoWriter/server/tsconfig.json --noEmit
   npm --prefix RepoWriter/server run build
   # Produces: RepoWriter/server/dist/index.js
   ```

3. Create a release artifact (example: tarball)

   ```bash
   cd RepoWriter/server
   npm ci --production
   tar -czf repowriter-server-$(git rev-parse --short HEAD).tar.gz dist node_modules package.json
   ```

**CI note:** The CI job `.github/workflows/repowriter-ci.yml` runs the build/test pipeline. Ensure the CI stores the built artifact in your artifact storage or pushes an image.

---

## Deploy options

### A — Systemd / VM

**Advantages:** simple, good for small fleets or single instance.

**Systemd unit (example)** — create `/etc/systemd/system/repowriter.service`:

```
[Unit]
Description=RepoWriter Server
After=network.target

[Service]
Type=simple
User=repowriter
Group=repowriter
WorkingDirectory=/srv/repowriter
EnvironmentFile=/etc/repowriter.env
ExecStart=/usr/bin/node /srv/repowriter/dist/index.js
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

**/etc/repowriter.env** (example) — unpacked by your secrets manager agent:

```
NODE_ENV=production
PORT=7071
REPO_PATH=/var/repowriter/repo
SIGNING_PROXY_URL=https://signer.prod.internal
SIGNING_PROXY_API_KEY=...
REQUIRE_SIGNING_PROXY=1
TELEMETRY_ENDPOINT=https://telemetry.internal/_ingest
OPENAI_API_KEY=...
LOG_LEVEL=info
```

**Deploy steps:**

1. Push artifact to VM `scp repowriter-server-*.tar.gz repowriter@vm:/srv/repowriter/`
2. On VM:

   ```bash
   sudo mkdir -p /srv/repowriter
   sudo tar -xzf repowriter-server-*.tar.gz -C /srv/repowriter
   # place /etc/repowriter.env from your secret manager
   sudo systemctl daemon-reload
   sudo systemctl enable --now repowriter
   sudo journalctl -u repowriter -f
   ```

### B — Docker Compose (simple cluster)

**docker-compose.yml** (production-like example — use secrets manager for envs):

```yaml
version: '3.8'
services:
  repowriter:
    image: your-registry/repowriter:stable
    restart: unless-stopped
    ports:
      - "7071:7071"
    environment:
      - NODE_ENV=production
      - PORT=7071
      - REPO_PATH=/var/repowriter/repo
      - SIGNING_PROXY_URL=https://signer.prod.internal
      - REQUIRE_SIGNING_PROXY=1
    volumes:
      - repowriter-repo:/var/repowriter/repo
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1024M

volumes:
  repowriter-repo:
```

### C — Kubernetes (recommended for scale)

**Minimal Deployment + Service example** (adjust for your infra):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: repowriter
  labels:
    app: repowriter
spec:
  replicas: 2
  selector:
    matchLabels:
      app: repowriter
  template:
    metadata:
      labels:
        app: repowriter
    spec:
      serviceAccountName: repowriter-sa
      containers:
        - name: repowriter
          image: your-registry/repowriter:stable
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 7071
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "7071"
            - name: SIGNING_PROXY_URL
              valueFrom:
                secretKeyRef:
                  name: repowriter-secrets
                  key: SIGNING_PROXY_URL
            - name: SIGNING_PROXY_API_KEY
              valueFrom:
                secretKeyRef:
                  name: repowriter-secrets
                  key: SIGNING_PROXY_API_KEY
            - name: REQUIRE_SIGNING_PROXY
              value: "1"
            - name: REPO_PATH
              value: "/srv/repowriter/repo"
            - name: TELEMETRY_ENDPOINT
              valueFrom:
                secretKeyRef:
                  name: repowriter-secrets
                  key: TELEMETRY_ENDPOINT
          readinessProbe:
            httpGet:
              path: /api/health
              port: 7071
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /api/health
              port: 7071
            initialDelaySeconds: 15
            periodSeconds: 20
      volumes:
        - name: repowriter-repo
          persistentVolumeClaim:
            claimName: repowriter-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: repowriter-svc
spec:
  selector:
    app: repowriter
  ports:
    - port: 7071
      targetPort: 7071
  type: ClusterIP
```

**Notes:**

* Store secrets in `repowriter-secrets` (Kubernetes Secret) or use HashiCorp Vault + CSI driver.
* Use NetworkPolicies to restrict egress only to signing proxy, OpenAI, telemetry.
* Use PodDisruptionBudgets and deployment strategies for safe rollouts.

---

## Secrets, KMS & signing proxy

**Signing (KMS) architecture**:

* RepoWriter never holds private keys. A dedicated signing-proxy (auth-protected, isolated) hosts KMS/HSM signing operations.
* Signing-proxy must:

  * Accept `POST /sign { payload_b64 }` returning `{ signature_b64, signer_id }`.
  * Audit all signing requests.
  * Support signer rotation and return `signer_id` for provenance.
  * Be accessible only from trusted networks or via mTLS.

**Key rotation & signer_id:**

* Signing-proxy must expose signer identifiers. Record `signer_id` in manifest metadata and audit events.
* Plan key rotation in signing-proxy; ensure RepoWriter records the signer id for historical verification.

**Secret management:**

* DO NOT put SIGNING_PROXY_API_KEY or other secrets into git. Use your secret manager. Mount secrets into K8s as `valueFrom` or inject at VM-level from Vault.

---

## Logging, metrics & alerting

**Logging**

* Structured JSON logs (if possible). Include request ids, actor ids, and manifest/operation ids.
* Errors should include stack traces and context (avoid printing secrets).

**Metrics (examples)**

* `repowriter.request.count` — labels: route, status
* `repowriter.signing.latency_seconds` — histograms
* `repowriter.signing.failures_total` — counts of signing errors
* `repowriter.apply.success_total` / `repowriter.apply.fail_total`

**Alerting**

* High error rate on `repowriter.signing.failures_total` when > 0 for 2 minutes (critical if REQUIRE_SIGNING_PROXY=1).
* High deployment failures or readiness probe failures for > 3 minutes.
* Unexpected audit sink errors or backlog growth.

---

## Health, readiness & SLOs

**Health endpoints**

* `GET /api/health` — basic up status.
* `GET /ready` — readiness: DB, signing-proxy reachability check (optional), repo mount accessible.

**SLO suggestions**

* Availability: 99.95% monthly for control-plane routes.
* Signing latency: p95 < 200ms for local signer; p95 < 500ms for external signing-proxy.
* Apply throughput: depends on your scale, but instrument and keep per-request timeout.

---

## Backups, audit retention & DR

* **Audit events**: store audit events to an append-only store (S3 with object-lock or equivalent). Ensure signed audit batches can be replayed for verification.
* **Repo backups**: backup the backed repo used by `REPO_PATH` or mount ephemeral repo backed by persistent storage that is replicated and backed up.
* **DR drill**: quarterly drill to restore from audit archive and rebuild manifest chain.

---

## Key security controls & reviews

* **Network**: restrict egress to known signing-proxy and telemetry endpoints. Use private networks/VPCs.
* **Auth**: use mTLS if possible for signing-proxy; otherwise strong bearer tokens with short lifetimes.
* **RBAC**: human operations (if any) gated by OIDC with 2FA.
* **Code review**: Security Engineer must sign off all changes touching `kernel/sign`, `RepoWriter/server/kernel/sign.ts`, and audit-related code.
* **Pen-tests & scans**: schedule regular vulnerability scans and pen-tests on the signing-proxy and RepoWriter.

---

## Rollout checklist & acceptance tests

**Pre-rollout**

* Signing-proxy deployed in production and reachable from RepoWriter host(s).
* Secrets configured in secret manager.
* CI green: `repowriter-ci` build & tests passed.
* `REQUIRE_SIGNING_PROXY=1` set in production env.

**Smoke tests (post-deploy)**

1. Health check: `GET /api/health` → `200`.
2. Sign a test manifest via API that triggers signing: ensure `signature` and `signerId` present and `signerId` matches signing-proxy expected id.
3. Perform an `apply` (dry → apply) against a non-sensitive repo and confirm:

   * commit created with `repowriter:` prefix
   * audit event emitted (check telemetry/audit sink)
4. Simulate signing proxy failure (temporary) with `REQUIRE_SIGNING_PROXY=1` and ensure service fails or returns errors per policy (test in staging).
5. Verify rollback functionality: apply a patch, then run rollback and validate repo restored.

**Automated acceptance**

* Use the CI acceptance job to do: health → plan → stream → dry → apply → verify commit → rollback → audit check.
* Ensure acceptance job runs before enabling traffic (or use canary rollout).

---

## Troubleshooting & diagnostics

* **Signing failures**:

  * Check `repowriter` logs for `Signing proxy error`.
  * Test connectivity to `SIGNING_PROXY_URL` (curl).
  * Check signing-proxy logs for request and audit entries.

* **Startup check failed**:

  * Review `repowriter` startup logs — the runStartupChecks() errors are explicit (missing REPO_PATH, missing fetch, etc.).

* **High latency for sign**:

  * instrument proxy latency and check network path; consider colocating signing-proxy or using private link.

---

## Final notes

* The combination of `REQUIRE_SIGNING_PROXY=1` plus `SIGNING_PROXY_URL` set is the single most important production guard.
* Keep production `REPOWRITER_SIGNING_SECRET` unset; it is strictly a dev/CI convenience.
* Record final signoffs in `RepoWriter/signoffs/*.sig` as required by acceptance (Security, Finance, Ryan).

---

## Contacts

* Final approver: **Ryan (SuperAdmin)**
* Security contact: **Security Engineer**
* SRE/Oncall: **SRE Team**

```
```

