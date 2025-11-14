# RBAC Header & Gateway Contract

This document codifies the role headers every gateway must set for service-to-service and human/admin calls. SentinelNet (and other downstream services) read a single header to decide whether the caller is a Kernel service, CommandPad operator, or other privileged role. Production deployments must match these values; local dev may override via env vars.

---

## Canonical header

| Setting | Value |
| --- | --- |
| Header name | `X-Sentinel-Roles` (case-insensitive). |
| Env var | `SENTINEL_RBAC_HEADER=x-sentinel-roles` |
| Allowed service roles | `kernel-service` (set via `SENTINEL_RBAC_CHECK_ROLES`). |
| Allowed human/admin roles | `kernel-admin,kernel-superadmin` (set via `SENTINEL_RBAC_POLICY_ROLES`). |

Services normalize the header to lowercase, split by comma, trim whitespace, and compare against the lowercase role values above.

---

## Gateway requirements

1. **Inject roles**  
   - Kernel → SentinelNet (and other services) traffic: gateway overwrites `X-Sentinel-Roles` with `kernel-service`.  
   - CommandPad / human operators: gateway maps the authenticated principal (OIDC claims) to `kernel-admin` or `kernel-superadmin` and sets the header accordingly. Example mapping: SuperAdmin (Ryan) → `kernel-superadmin`; security engineers → `kernel-admin`.
2. **Strip untrusted headers**  
   - Drop any inbound `X-Sentinel-Roles` header from the external network before setting your own value to prevent spoofing.
3. **TLS + mTLS**  
   - Gateways must enforce mTLS for service traffic (Kernel, Finance, etc.). SentinelNet now refuses to start in production when `DEV_SKIP_MTLS=true`.
4. **Propagation to downstream services**  
   - If a service fans out to another protected API, it must forward the sanitized header instead of reusing user-provided values. Kernel remains the root of trust and should stamp roles whenever it initiates a call.

---

## Example (Envoy)

```yaml
request_headers_to_remove:
  - x-sentinel-roles
request_headers_to_add:
  - header:
      key: x-sentinel-roles
      value: kernel-service
    append_action: OVERWRITE_IF_EXISTS
```

For CommandPad/human routes, create a dedicated listener (or use Lua/ext_authz) that inspects the authenticated subject and sets the header to `kernel-admin` or `kernel-superadmin`.

---

## Operational expectations

- **Production guardrails**: SentinelNet enforces RBAC in `NODE_ENV=production`. Startup fails if `SENTINEL_RBAC_ENABLED=false`, or if either role list is empty. Use the values above unless explicitly coordinating a change with Security.
- **Auditability**: Downstream services should log the resolved role along with the caller identity to aid investigations.
- **Role rotation**: Any change to role names requires coordinated updates here, in the API gateway config, and in the consuming services’ env vars and tests.
