package auth

import (
	"context"
	"crypto/x509"
	"log"
	"net/http"
	"strings"

	"github.com/ILLUVRSE/Main/kernel/internal/config"
)

// key types for context values
type ctxKey string

const (
	ctxKeyAuthInfo ctxKey = "kernel.authInfo"
)

// AuthInfo holds extracted authentication information for the request.
type AuthInfo struct {
	// Peer service identity (from client cert CN) when using mTLS.
	PeerCN string

	// Raw bearer token (if provided). Token validation is not performed by this middleware.
	BearerToken string

	// Subject (sub claim) extracted from validated token (populated by OIDC middleware).
	Subject string

	// Issuer (iss claim) extracted from validated token (populated by OIDC middleware).
	Issuer string

	// Derived roles (populated by RBAC/oidc helper later).
	Roles []string
}

// FromContext returns the AuthInfo stored in the request context, or nil.
func FromContext(ctx context.Context) *AuthInfo {
	v := ctx.Value(ctxKeyAuthInfo)
	if v == nil {
		return nil
	}
	if ai, ok := v.(*AuthInfo); ok {
		return ai
	}
	return nil
}

// NewMiddleware returns an HTTP middleware that enforces the minimal auth policy:
// - If cfg.RequireMTLS == true, a peer certificate must be presented (TLS termination must pass through client certs).
// - It extracts the peer cert CN (if present) and any Bearer token into the request context for downstream use.
//
// NOTE: This middleware does NOT perform OIDC token validation or role mapping. It only extracts auth info.
// Implement OIDC validation and RBAC in separate helpers that read AuthInfo from context.
func NewMiddleware(cfg *config.Config) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ai := &AuthInfo{}

			// mTLS: require client cert if configured
			if cfg.RequireMTLS {
				// r.TLS may be nil if server not configured for TLS; in production TLS termination will supply TLS info.
				if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
					http.Error(w, "mTLS required", http.StatusUnauthorized)
					return
				}
				// Use the first peer certificate (leaf)
				peerCert := r.TLS.PeerCertificates[0]
				ai.PeerCN = certCommonName(peerCert)
			} else {
				// not required, but if a cert is present, extract CN
				if r.TLS != nil && len(r.TLS.PeerCertificates) > 0 {
					ai.PeerCN = certCommonName(r.TLS.PeerCertificates[0])
				}
			}

			// Extract Bearer token (if present) for downstream OIDC validation
			if authz := r.Header.Get("Authorization"); authz != "" {
				if strings.HasPrefix(strings.ToLower(authz), "bearer ") {
					ai.BearerToken = strings.TrimSpace(authz[7:])
				}
			}

			// Structured debug: show what was extracted (no secrets)
			tokenPresent := ai.BearerToken != ""
			log.Printf("[auth] principal extracted peer_cn=%q token_present=%v require_mtls=%v",
				ai.PeerCN, tokenPresent, cfg.RequireMTLS)

			// place AuthInfo into context for downstream use
			ctx := context.WithValue(r.Context(), ctxKeyAuthInfo, ai)
			r = r.WithContext(ctx)

			next.ServeHTTP(w, r)
		})
	}
}

func certCommonName(cert *x509.Certificate) string {
	if cert == nil {
		return ""
	}
	return cert.Subject.CommonName
}
