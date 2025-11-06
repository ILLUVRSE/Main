// package config provides a minimal environment-backed configuration loader
// used by the kernel bootstrap (cmd/kernel/main.go).
package config

import (
	"os"
	"strconv"
)

// Config holds the small set of runtime config values used by main.go.
// Keep this intentionally minimal — we can expand later.
type Config struct {
	DatabaseURL              string // DATABASE_URL
	RequireKMS               bool   // REQUIRE_KMS
	KMSEndpoint              string // KMS_ENDPOINT
	LocalSignerID            string // LOCAL_SIGNER_ID (fallback signer)
	RequireMTLS              bool   // REQUIRE_MTLS
	ListenAddr               string // LISTEN_ADDR (default :8080)

	// OIDC / JWKS
	OIDCIssuer           string // OIDC_ISSUER
	OIDCAudience         string // OIDC_AUDIENCE
	JWKSURL              string // JWKS_URL
	JWKSCacheTTLSeconds  int    // JWKS_CACHE_TTL_SECONDS (default 300)

	// TLS file paths (optional; main.go reads env directly today, but we keep here for consistency)
	TLSCertPath     string // TLS_CERT_PATH
	TLSKeyPath      string // TLS_KEY_PATH
	TLSClientCAPath string // TLS_CLIENT_CA_PATH
}

// LoadFromEnv reads config values from environment variables and returns a Config pointer.
func LoadFromEnv() *Config {
	cfg := &Config{
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		KMSEndpoint:   os.Getenv("KMS_ENDPOINT"),
		LocalSignerID: os.Getenv("LOCAL_SIGNER_ID"),
		ListenAddr:    os.Getenv("LISTEN_ADDR"),

		OIDCIssuer:          os.Getenv("OIDC_ISSUER"),
		OIDCAudience:        os.Getenv("OIDC_AUDIENCE"),
		JWKSURL:             os.Getenv("JWKS_URL"),
		TLSCertPath:         os.Getenv("TLS_CERT_PATH"),
		TLSKeyPath:          os.Getenv("TLS_KEY_PATH"),
		TLSClientCAPath:     os.Getenv("TLS_CLIENT_CA_PATH"),
	}

	// sensible defaults
	if cfg.LocalSignerID == "" {
		cfg.LocalSignerID = "local-signer-1"
	}
	if cfg.ListenAddr == "" {
		cfg.ListenAddr = ":8080"
	}

	// JWKS cache TTL default
	cfg.JWKSCacheTTLSeconds = 300
	if v := os.Getenv("JWKS_CACHE_TTL_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.JWKSCacheTTLSeconds = n
		}
	}

	// booleans parsed permissively; default false
	if v := os.Getenv("REQUIRE_KMS"); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			cfg.RequireKMS = b
		}
	}
	if v := os.Getenv("REQUIRE_MTLS"); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			cfg.RequireMTLS = b
		}
	}

	return cfg
}

