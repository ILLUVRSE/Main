// kernel/test/unit/rbac.unit.test.ts
import { mapOidcRolesToCanonical, principalFromOidcClaims, principalFromCert } from '../../src/auth/roleMapping';
import { hasAnyRole, Roles } from '../../src/rbac';

describe('roleMapping', () => {
  test('mapOidcRolesToCanonical maps known role strings to canonical roles', () => {
    const inRoles = ['SuperAdmin', 'division-lead', 'operator', 'custom-role'];
    const mapped = mapOidcRolesToCanonical(inRoles);
    // canonical roles should include mapped values and keep unknown role as-is
    expect(mapped).toEqual(expect.arrayContaining([
      Roles.SUPERADMIN,
      Roles.DIVISION_LEAD,
      Roles.OPERATOR,
      'custom-role',
    ]));
  });

  test('principalFromOidcClaims extracts sub and canonical roles from realm_access', () => {
    const claims = {
      sub: 'u1',
      realm_access: {
        roles: ['superadmin', 'operator'],
      },
    };
    const p = principalFromOidcClaims(claims);
    expect(p.type).toBe('human');
    expect(p.id).toBe('u1');
    expect(p.roles).toEqual(expect.arrayContaining([Roles.SUPERADMIN, Roles.OPERATOR]));
  });

  test('principalFromOidcClaims handles resource_access client roles', () => {
    const claims = {
      sub: 'u2',
      resource_access: {
        'kernel-client': { roles: ['division-lead'] },
        'other-client': { roles: ['auditor'] },
      },
    };
    const p = principalFromOidcClaims(claims);
    expect(p.type).toBe('human');
    expect(p.id).toBe('u2');
    expect(p.roles).toEqual(expect.arrayContaining([Roles.DIVISION_LEAD, Roles.AUDITOR]));
  });
});

describe('cert mapping and rbac helpers', () => {
  test('principalFromCert maps CN to service principal and Operator role by default', () => {
    const cert = { subject: { CN: 'svc-kernel-client' }, subjectaltname: 'DNS:svc-kernel-client' };
    const p = principalFromCert(cert);
    expect(p.type).toBe('service');
    expect(p.id).toBe('svc-kernel-client');
    expect(p.roles).toEqual(expect.arrayContaining([Roles.OPERATOR]));
  });

  test('principalFromCert maps auditor token to Auditor role', () => {
    const cert = { subject: { CN: 'auditor-service' }, subjectaltname: 'DNS:auditor-service' };
    const p = principalFromCert(cert);
    expect(p.roles).toEqual(expect.arrayContaining([Roles.AUDITOR]));
  });

  test('hasAnyRole returns true if principal has one of the required roles', () => {
    const principal = { type: 'human', id: 'u3', roles: [Roles.OPERATOR] };
    expect(hasAnyRole(principal as any, [Roles.OPERATOR, Roles.AUDITOR])).toBe(true);
    expect(hasAnyRole(principal as any, Roles.OPERATOR)).toBe(true);
    expect(hasAnyRole(principal as any, Roles.SUPERADMIN)).toBe(false);
  });
});

