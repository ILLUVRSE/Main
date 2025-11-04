package auth

import (
	"net/http"
)

// Canonical role names used across the system.
const (
	RoleSuperAdmin   = "SuperAdmin"
	RoleDivisionLead = "DivisionLead"
	RoleOperator     = "Operator"
	RoleAuditor      = "Auditor"
)

// HasRole returns true if the provided AuthInfo contains the requested role.
// It checks:
// 1) explicit Roles slice, and
// 2) fallback: peer CN equals the role string (useful for quick tests or service identities).
func HasRole(ai *AuthInfo, role string) bool {
	if ai == nil {
		return false
	}
	for _, r := range ai.Roles {
		if r == role {
			return true
		}
	}
	// Fallback: if peer CN exactly equals the role name, treat it as having that role.
	// This is NOT a substitute for proper OIDC / role mapping, but is handy for bootstrapping.
	if ai.PeerCN != "" && ai.PeerCN == role {
		return true
	}
	return false
}

// RequireRole returns a middleware that allows the request to continue only if
// the request's AuthInfo (in context) has the given role. Otherwise 403 is returned.
func RequireRole(role string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ai := FromContext(r.Context())
			if HasRole(ai, role) {
				next.ServeHTTP(w, r)
				return
			}
			http.Error(w, "forbidden", http.StatusForbidden)
		})
	}
}

// RequireAnyRole returns middleware that allows the request if the AuthInfo has
// any one of the provided roles.
func RequireAnyRole(roles ...string) func(http.Handler) http.Handler {
	roleSet := make(map[string]struct{}, len(roles))
	for _, rr := range roles {
		roleSet[rr] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ai := FromContext(r.Context())
			if ai == nil {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			for _, role := range ai.Roles {
				if _, ok := roleSet[role]; ok {
					next.ServeHTTP(w, r)
					return
				}
			}
			// fallback: check peer CN against roles
			for rr := range roleSet {
				if ai.PeerCN == rr {
					next.ServeHTTP(w, r)
					return
				}
			}
			http.Error(w, "forbidden", http.StatusForbidden)
		})
	}
}

