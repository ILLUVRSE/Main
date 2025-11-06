package handlers

import (
	"net/http"

	"github.com/ILLUVRSE/Main/kernel/internal/auth"
)

// JWKSStatusHandler returns an HTTP handler that exposes JWKS metrics as JSON.
// If jwks is nil, it returns 404.
func JWKSStatusHandler(jwks *auth.JWKSCache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if jwks == nil {
			http.Error(w, "jwks not configured", http.StatusNotFound)
			return
		}
		m := auth.GetJWKSMetrics()
		writeJSON(w, http.StatusOK, m)
	}
}
