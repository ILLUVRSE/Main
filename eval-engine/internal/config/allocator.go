package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type AllocatorConfig struct {
	Addr                string
	DatabaseURL         string
	Pools               []PoolConfig
	SentinelMaxDelta    int
	SentinelDeniedPools []string
}

type PoolConfig struct {
	Name     string
	Capacity int
}

const (
	defaultAllocatorAddr = ":8052"
	defaultMaxDelta      = 5
)

func LoadAllocator() (AllocatorConfig, error) {
	cfg := AllocatorConfig{
		Addr:                getEnv("RESOURCE_ALLOCATOR_ADDR", defaultAllocatorAddr),
		DatabaseURL:         firstNonEmpty(os.Getenv("RESOURCE_ALLOCATOR_DATABASE_URL"), os.Getenv("DATABASE_URL")),
		Pools:               parsePools(getEnv("RESOURCE_ALLOCATOR_POOLS", "gpus-us-east:10")),
		SentinelMaxDelta:    getInt("RESOURCE_ALLOCATOR_MAX_DELTA", defaultMaxDelta),
		SentinelDeniedPools: parseCSV(os.Getenv("RESOURCE_ALLOCATOR_DENY_POOLS")),
	}
	if cfg.DatabaseURL == "" {
		return AllocatorConfig{}, fmt.Errorf("DATABASE_URL or RESOURCE_ALLOCATOR_DATABASE_URL required")
	}
	return cfg, nil
}

func parsePools(raw string) []PoolConfig {
	chunks := strings.Split(raw, ",")
	pools := make([]PoolConfig, 0, len(chunks))
	for _, chunk := range chunks {
		chunk = strings.TrimSpace(chunk)
		if chunk == "" {
			continue
		}
		parts := strings.Split(chunk, ":")
		name := parts[0]
		cap := 1
		if len(parts) > 1 {
			if v, err := strconv.Atoi(parts[1]); err == nil {
				cap = v
			}
		}
		pools = append(pools, PoolConfig{Name: name, Capacity: cap})
	}
	return pools
}

func parseCSV(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}
