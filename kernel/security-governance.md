# Kernel — Security & Governance

## Purpose
This document defines the security model and governance controls for the Kernel. It covers authentication/authorization, service identity, key management, signing rules, multi-sig upgrade requirements, SentinelNet enforcement hooks, audit expectations, and incident/rotation procedures.

---

## 1) High-level model
- **Human access**: OIDC/SSO with strong 2FA required for privileged roles.  
- **Service access**: mutual TLS (mTLS) for service-to-service authentication and authorization.  
- **Signing**: Ed25519 signatures for manifests and audit events. Signing keys live in KMS/HSM and are never exported in clear.  
- **Policy enforcement**: SentinelNet enforces policies in real time and can block or quarantine actions that violate governance rules.  
- **Principle**: least privilege everywhere. Everything must be auditable and reversible via signed events and multi-sig for system-level changes.

---

## 2) Roles & RBAC
- **SuperAdmin** (Ryan): full authority; able to approve multi-sig upgrades and break glass.  
- **DivisionLead**: manages division manifests for assigned divisions (create/update within policy and budget).  
- **Operator**: day-to-day operator for agent lifecycle, resource requests (subject to policy).  
- **SecurityEngineer**: manages KMS/HSM, SentinelNet rules, incident response.  
- **Auditor**: read-only access to audit logs and reasoning traces.  
- **ServiceAccount**: non-human identities for infra services; authenticated via mTLS certs and mapped to least-privilege roles.

**Enforcement rules**
- All API calls must be evaluated against RBAC. Some endpoints require escalation (e.g., kernel-level upgrade requires multi-sig).  
- Role-to-permission mappings retained in Kernel and enforced at the API gateway layer.

---

## 3) Human authentication (OIDC/SSO)
- Use enterprise-grade OIDC provider with enforced 2FA/SMS/Authenticator apps.  
- Map SSO groups to Kernel roles (SuperAdmin, DivisionLead, Operator, Auditor).  
- Expire interactive sessions after reasonable idle time (e.g., 30 minutes) and require reauth for sensitive flows.  
- Log all login events to the audit bus.

---

## 4) Service authentication (mTLS)
- All services must present mTLS certs issued by an internal CA.  
- The Kernel validates client certs, extracts service identity, and maps to service roles.  
- Short-lived certs preferred (e.g., 7–30 days) with automated rotation via CI/CD or Vault PKI.  
- Reject connections without mTLS; reject certs not in the allowed service registry.

---

## 5) KMS / HSM & signing
- **Primary rule**: signing keys (Ed25519) are managed in KMS/HSM and never leave the HSM in plaintext.  
- Key hierarchy:
  - **Root signing key**: stored in HSM, highly restricted, multi-person access controls (used only for bootstrapping / recovery).  
  - **Kernel signer keys**: day-to-day manifest signing keys in KMS with strict IAM policies.  
  - **Service signing keys**: scoped keys for services/agents where necessary (prefer short-lived).  
- **Signing process**:
  - Kernel builds canonical manifest JSON, requests signing from KMS/HSM, receives signature, stores ManifestSignature record (signerId, signature, ts) and emits an audit event linking to the signature.
- **Key identifiers**: keys must use stable `signer_id` values (e.g., `kernel-signer-1`) so signatures are traceable.

---

## 6) Key rotation & compromise procedure
- **Rotation cadence**: automatic rotation every 90 days for signer keys; emergency rotation whenever compromise is suspected.  
- **Rotation process**:
  1. Generate new key in KMS/HSM.  
  2. Update Kernel signer mapping to include both old and new keys for a short overlap window.  
  3. Re-sign any pending manifests if required and record new ManifestSignature entries.  
  4. Publish rotation event to audit bus.
- **Compromise response**:
  - Immediately revoke key in KMS/HSM; issue emergency SentinelNet block for any signed actions by compromised signer.  
  - Run audit query to locate impacted manifests and replay verification.  
  - Initiate multi-sig recovery to re-establish trust and rotate dependent keys.

---

## 7) Multi-sig upgrade policy (brief)
- Kernel-level code or manifest upgrades that change the Kernel core or governance must be approved by **3-of-5** approvers.  
- Approver roles: SuperAdmin (Ryan) + 4 appointed Division Leads / Security Engineer / Technical Lead.  
- **Artifacts to sign**: upgrade manifest (with patch hash), rationale, and timestamp. Each approver records a signed approval event.  
- Once quorum reached, Kernel applies the upgrade and emits a signed audit event with the list of approvers and signatures.  
- Rollback requires another multi-sig flow and a signed rollback manifest.

---

## 8) SentinelNet integration
- SentinelNet receives copies of API requests and audit events (or a summarized webhook) and evaluates active policy rules.  
- On policy violation options:
  - **Block** (reject request and return policy error).  
  - **Quarantine** (permit action but isolate resources and mark for manual review).  
  - **Remediate** (auto-run a pre-approved remediation such as revoke cert or reduce allocation).  
- All SentinelNet decisions are recorded as audit events and include the policy id, decision, confidence, and rationale.

---

## 9) Audit & logging
- All critical actions produce AuditEvent entries (prevHash, hash, signature). Audit events are append-only and stored in a durable sink (S3/Postgres) and streamed via Kafka.  
- Audit access: read-only for Auditors; SuperAdmin can request exports and cryptographic proofs.  
- Event retention: primary copy retained for N years (policy), secondary immutable snapshot archived in cold storage with verifiable hashes.  
- Log integrity: periodic verification job to validate the hash chain and signatures.

---

## 10) Secrets & environment management
- Use Vault or cloud secret manager as source of truth. Do not store secrets in code or git.  
- CI/CD pipelines fetch secrets dynamically and inject ephemeral credentials.  
- Access to secrets must be logged and limited to approved service accounts.

---

## 11) Incident response & governance
- Define an incident playbook: detection → triage → contain → eradicate → recover → post-mortem. SecurityEngineer leads and notifies SuperAdmin + Legal when required.  
- All incident actions (key revocation, node isolation, code rollback) must be recorded as signed audit events.  
- Post-incident, update SentinelNet rules if the incident exposes policy gaps.

---

## 12) Compliance & third-party audits
- Produce signed, verifiable audit exports for external auditors.  
- Quarterly security reviews and annual external pentests.  
- Maintain evidence for key rotation, signer access, and audit log integrity.

---

## Acceptance criteria (for this doc)
- RBAC roles & enforcement model documented.  
- OIDC/SSO + mTLS patterns defined.  
- KMS/HSM signing rules, signer_id convention, and rotation/compromise procedures described.  
- Brief multi-sig upgrade policy outlined.  
- SentinelNet roles and expected reactions documented.  
- Emergency key revocation and recovery flow present.


