package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Addr             string
	DatabaseURL      string
	SignerKeyB64     string
	SignerID         string
	KMSEndpoint      string
	SentinelMinScore float64
	SentinelURL      string
	AllowDebugToken  bool
	DebugToken       string
}

const (
	defaultAddr             = ":8061"
	defaultSignerID         = "ai-infra-dev"
	defaultSentinelMinScore = 0.8
)

func Load() (Config, error) {
	cfg := Config{
		Addr:             getEnv("AI_INFRA_ADDR", defaultAddr),
		DatabaseURL:      firstNonEmpty(os.Getenv("AI_INFRA_DATABASE_URL"), os.Getenv("DATABASE_URL")),
		SignerKeyB64:     os.Getenv("AI_INFRA_SIGNER_KEY_B64"),
		SignerID:         getEnv("AI_INFRA_SIGNER_ID", defaultSignerID),
		KMSEndpoint:      os.Getenv("AI_INFRA_KMS_ENDPOINT"),
		SentinelMinScore: getFloat("AI_INFRA_MIN_PROMO_SCORE", defaultSentinelMinScore),
		SentinelURL:      os.Getenv("AI_INFRA_SENTINEL_URL"),
		AllowDebugToken:  getBool("AI_INFRA_ALLOW_DEBUG_TOKEN", false),
		DebugToken:       os.Getenv("AI_INFRA_DEBUG_TOKEN"),
	}
	nodeEnv := os.Getenv("NODE_ENV")
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL or AI_INFRA_DATABASE_URL required")
	}
	if cfg.KMSEndpoint == "" && cfg.SignerKeyB64 == "" {
		return Config{}, fmt.Errorf("AI_INFRA_SIGNER_KEY_B64 required when AI_INFRA_KMS_ENDPOINT unset")
	}
	if nodeEnv == "production" && cfg.KMSEndpoint == "" {
		return Config{}, fmt.Errorf("AI_INFRA_KMS_ENDPOINT (or KMS_ENDPOINT) required in production")
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func getFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return fallback
}

func getBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}
