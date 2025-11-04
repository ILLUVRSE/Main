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
	DatabaseURL   string // DATABASE_URL
	RequireKMS    bool   // REQUIRE_KMS
	KMSEndpoint   string // KMS_ENDPOINT
	LocalSignerID string // LOCAL_SIGNER_ID (fallback signer)
	RequireMTLS   bool   // REQUIRE_MTLS
	ListenAddr    string // LISTEN_ADDR (default :8080)
}

// LoadFromEnv reads config values from environment variables and returns a Config pointer.
func LoadFromEnv() *Config {
	cfg := &Config{
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		KMSEndpoint:   os.Getenv("KMS_ENDPOINT"),
		LocalSignerID: os.Getenv("LOCAL_SIGNER_ID"),
		ListenAddr:    os.Getenv("LISTEN_ADDR"),
	}

	// sensible defaults
	if cfg.LocalSignerID == "" {
		cfg.LocalSignerID = "local-signer-1"
	}
	if cfg.ListenAddr == "" {
		cfg.ListenAddr = ":8080"
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
