package auth

import "strings"

// Canonical role names used throughout the codebase.
const (
	RoleSuperAdmin   = "SuperAdmin"
	RoleDivisionLead = "DivisionLead"
	RoleOperator     = "Operator"
	RoleAuditor      = "Auditor"
)

// HasRole returns true if the provided AuthInfo contains the (canonical) role.
// Role matching is case-insensitive and accepts common variants (underscores/hyphens).
func HasRole(ai *AuthInfo, role string) bool {
	if ai == nil || len(ai.Roles) == 0 {
		return false
	}
	want := normalizeRole(role)
	for _, r := range ai.Roles {
		if normalizeRole(r) == want {
			return true
		}
	}
	return false
}

// HasAnyRole returns true if AuthInfo has any of the provided roles.
func HasAnyRole(ai *AuthInfo, roles ...string) bool {
	if ai == nil || len(ai.Roles) == 0 || len(roles) == 0 {
		return false
	}
	for _, want := range roles {
		if HasRole(ai, want) {
			return true
		}
	}
	return false
}

// MapClaimsToRoles extracts roles from token claims and maps them to canonical names.
// It uses the existing extractRolesFromClaims helper and then normalizes/mappings.
func MapClaimsToRoles(claims map[string]interface{}) []string {
	raw := extractRolesFromClaims(claims)
	out := make([]string, 0, len(raw))
	seen := map[string]struct{}{}
	for _, r := range raw {
		c := normalizeRole(r)
		if c == "" {
			continue
		}
		// Map common aliases to canonical role names.
		switch c {
		case "superadmin", "super_admin", "super-admin":
			c = RoleSuperAdmin
		case "divisionlead", "division_lead", "division-lead", "divisionleadership":
			c = RoleDivisionLead
		case "operator", "ops", "operator_role":
			c = RoleOperator
		case "auditor", "audit":
			c = RoleAuditor
		default:
			// Capitalize first letter for readability (e.g., "developer" -> "Developer")
			c = strings.Title(strings.ToLower(c))
		}
		if _, ok := seen[c]; !ok {
			seen[c] = struct{}{}
			out = append(out, c)
		}
	}
	return out
}

// normalizeRole lowercases and removes spaces/underscores/hyphens for comparison.
func normalizeRole(r string) string {
	r = strings.TrimSpace(r)
	r = strings.ToLower(r)
	r = strings.ReplaceAll(r, "_", "")
	r = strings.ReplaceAll(r, "-", "")
	r = strings.ReplaceAll(r, " ", "")
	return r
}
