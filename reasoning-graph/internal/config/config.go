package config

import (
	"fmt"
	"os"
	"strconv"
)

// Config captures runtime settings for the Reasoning Graph service.
type Config struct {
	Addr                string
	DatabaseURL         string
	DebugToken          string
	AllowDebugToken     bool
	SignerKeyB64        string
	SignerID            string
	MaxTraceDepth       int
	SnapshotDepth       int
	MaxSnapshotRoots    int
	MaxNodePayloadBytes int
}

const (
	defaultAddr             = ":8047"
	defaultMaxTraceDepth    = 5
	defaultSnapshotDepth    = 2
	defaultMaxSnapshotRoots = 32
	defaultPayloadLimit     = 256 * 1024 // 256KB
)

// Load reads environment variables and returns a Config.
func Load() (Config, error) {
	cfg := Config{
		Addr:                getEnv("REASONING_GRAPH_ADDR", defaultAddr),
		DatabaseURL:         firstNonEmpty(os.Getenv("REASONING_GRAPH_DATABASE_URL"), os.Getenv("DATABASE_URL")),
		DebugToken:          os.Getenv("REASONING_GRAPH_DEBUG_TOKEN"),
		AllowDebugToken:     getBool("REASONING_GRAPH_ALLOW_DEBUG_TOKEN", false),
		SignerKeyB64:        os.Getenv("REASONING_GRAPH_SNAPSHOT_KEY_B64"),
		SignerID:            getEnv("REASONING_GRAPH_SIGNER_ID", "reasoning-graph-dev"),
		MaxTraceDepth:       getInt("REASONING_GRAPH_MAX_TRACE_DEPTH", defaultMaxTraceDepth),
		SnapshotDepth:       getInt("REASONING_GRAPH_SNAPSHOT_DEPTH", defaultSnapshotDepth),
		MaxSnapshotRoots:    getInt("REASONING_GRAPH_MAX_SNAPSHOT_ROOTS", defaultMaxSnapshotRoots),
		MaxNodePayloadBytes: getInt("REASONING_GRAPH_MAX_NODE_PAYLOAD_BYTES", defaultPayloadLimit),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL or REASONING_GRAPH_DATABASE_URL is required")
	}
	if cfg.SignerKeyB64 == "" {
		return Config{}, fmt.Errorf("REASONING_GRAPH_SNAPSHOT_KEY_B64 is required")
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		ok, err := strconv.ParseBool(v)
		if err == nil {
			return ok
		}
	}
	return fallback
}

func getInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil && i > 0 {
			return i
		}
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
