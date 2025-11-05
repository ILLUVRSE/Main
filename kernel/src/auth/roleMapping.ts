// kernel/src/auth/roleMapping.ts
// Deterministic role-mapping utilities for Kernel.
// - mapOidcRolesToCanonical: normalize various upstream role names into canonical roles.
// - principalFromOidcClaims: returns a Principal-like object for OIDC human principals.
// - principalFromCert: returns a Principal-like object for mTLS service principals.

import { Principal as RbacPrincipal, Roles } from '../rbac';

export type Principal = RbacPrincipal;

/**
 * Normalize and dedupe role names.
 */
function uniq(items: string[]) {
  return Array.from(new Set(items));
}

/**
 * Map free-form role strings to canonical roles where possible.
 */
export function mapOidcRolesToCanonical(rawRoles: string[] = []): string[] {
  if (!Array.isArray(rawRoles) || rawRoles.length === 0) return [];

  const mapped: string[] = [];
  for (const r of rawRoles) {
    if (!r || typeof r !== 'string') continue;
    const key = r.replace(/[\s_\-]+/g, '').toLowerCase();

    if (['superadmin', 'super-admin', 'realmadmin', 'realmadmin'].includes(key) || /superadmin/.test(key)) {
      mapped.push(Roles.SUPERADMIN);
      continue;
    }
    if (['divisionlead', 'division-lead', 'division_lead'].includes(key) || /division/.test(key)) {
      mapped.push(Roles.DIVISION_LEAD);
      continue;
    }
    if (['operator', 'ops', 'op'].includes(key) || /operator|ops?/.test(key)) {
      mapped.push(Roles.OPERATOR);
      continue;
    }
    if (['auditor', 'audit'].includes(key) || /auditor/.test(key)) {
      mapped.push(Roles.AUDITOR);
      continue;
    }

    // Unknown role: keep original representation (trimmed)
    mapped.push(r.trim());
  }

  return uniq(mapped);
}

/**
 * principalFromOidcClaims
 */
export function principalFromOidcClaims(claims: any): Principal {
  const id =
    String(claims?.sub ?? claims?.uid ?? claims?.user_id ?? claims?.preferred_username ?? claims?.preferredUsername ?? 'unknown');

  let roles: string[] = [];

  if (Array.isArray(claims?.realm_access?.roles)) roles = roles.concat(claims.realm_access.roles);
  if (claims?.resource_access && typeof claims.resource_access === 'object') {
    for (const k of Object.keys(claims.resource_access)) {
      const entry = claims.resource_access[k];
      if (entry && Array.isArray(entry.roles)) roles = roles.concat(entry.roles);
    }
  }
  if (Array.isArray(claims?.roles)) roles = roles.concat(claims.roles);
  if (typeof claims?.roles === 'string') roles = roles.concat(claims.roles.split(/[,\s]+/).filter(Boolean));
  if (typeof claims?.scope === 'string') roles = roles.concat(claims.scope.split(/\s+/).filter(Boolean));
  if (Array.isArray(claims?.groups)) roles = roles.concat(claims.groups);
  if (typeof claims?.groups === 'string') roles = roles.concat(claims.groups.split(/[,\s]+/).filter(Boolean));

  const canonical = mapOidcRolesToCanonical(roles);
  return { type: 'human', id, roles: canonical };
}

/**
 * principalFromCert
 */
export function principalFromCert(cert: any): Principal {
  let cn: string | undefined = undefined;

  try {
    if (!cert) return { type: 'service', id: 'service-unknown', roles: [Roles.OPERATOR] };

    if (typeof cert === 'string') cn = cert;
    else if (cert.subject && typeof cert.subject === 'object') cn = String(cert.subject.CN || cert.subject.commonName || '');
    else if (cert.subjectString) cn = String(cert.subjectString);
    else if (cert.commonName) cn = String(cert.commonName);
    else if (cert.CN) cn = String(cert.CN);
    else cn = JSON.stringify(cert).slice(0, 128);
  } catch {
    cn = undefined;
  }

  const id = cn || (cert?.subject ? JSON.stringify(cert.subject) : 'service-unknown');
  const isAuditor = typeof id === 'string' && /auditor|audit/i.test(id);
  return { type: 'service', id, roles: isAuditor ? [Roles.AUDITOR] : [Roles.OPERATOR] };
}

export default {
  mapOidcRolesToCanonical,
  principalFromOidcClaims,
  principalFromCert,
};

