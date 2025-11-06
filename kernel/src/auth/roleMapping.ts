// kernel/src/auth/roleMapping.ts
// Deterministic role-mapping utilities for Kernel.
// - mapOidcRolesToCanonical: normalize various upstream role names into canonical roles.
// - principalFromOidcClaims: returns a Principal-like object for OIDC human principals.
// - principalFromCert: returns a Principal-like object for mTLS service principals.

import { Principal as RbacPrincipal, Roles } from '../rbac';

function loadServiceRoleMap(): Record<string, string[]> {
  const raw = process.env.SERVICE_ROLE_MAP;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const map: Record<string, string[]> = {};
    if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed)) {
        if (!value) continue;
        if (Array.isArray(value)) {
          map[key] = value.map((v) => String(v));
        } else if (typeof value === 'string') {
          map[key] = value
            .split(/[\s,]+/)
            .map((v) => v.trim())
            .filter(Boolean);
        }
      }
    }
    return map;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('roleMapping: failed to parse SERVICE_ROLE_MAP:', (err as Error).message);
    return {};
  }
}

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
  const roleMap = loadServiceRoleMap();

  const candidates: string[] = [];
  try {
    if (!cert) {
      return { type: 'service', id: 'service-unknown', roles: [Roles.OPERATOR] };
    }

    if (typeof cert === 'string' && cert.trim()) {
      candidates.push(cert.trim());
    }

    const subject = cert.subject || cert.subjectCertificate || {};
    if (subject && typeof subject === 'object') {
      const cn = subject.CN || subject.commonName;
      if (cn && typeof cn === 'string') candidates.push(cn);
    }

    if (typeof cert.subjectString === 'string' && cert.subjectString.includes('/CN=')) {
      const match = cert.subjectString.match(/\/CN=([^\/,;+]+)/);
      if (match?.[1]) candidates.push(match[1]);
    }

    if (typeof cert.CN === 'string') candidates.push(cert.CN);
    if (typeof cert.commonName === 'string') candidates.push(cert.commonName);

    const rawAlt = cert.subjectaltname || cert.subjectAltName || cert.altNames;
    if (rawAlt) {
      const list = Array.isArray(rawAlt) ? rawAlt : String(rawAlt).split(/[,\s]+/);
      for (const entry of list) {
        if (!entry) continue;
        const text = String(entry).trim();
        if (!text) continue;
        const idx = text.indexOf(':');
        const value = idx >= 0 ? text.slice(idx + 1) : text;
        if (value) candidates.push(value.trim());
      }
    }
  } catch {
    // ignore parsing errors; fall back below
  }

  const normalized = candidates.map((c) => c && c.trim()).filter(Boolean) as string[];
  const uniqueCandidates = Array.from(new Set(normalized));
  const matchedId = uniqueCandidates.find((c) => roleMap[c] && roleMap[c].length > 0);
  const id = matchedId || uniqueCandidates[0] || 'service-unknown';

  let roles: string[] | undefined = matchedId ? roleMap[matchedId] : undefined;
  if (!roles || roles.length === 0) {
    roles = /auditor|audit/i.test(id) ? [Roles.AUDITOR] : [Roles.OPERATOR];
  }

  return { type: 'service', id, roles: Array.from(new Set(roles)) };
}

export default {
  mapOidcRolesToCanonical,
  principalFromOidcClaims,
  principalFromCert,
};

