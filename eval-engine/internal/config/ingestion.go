package config

import (
	"fmt"
	"os"
	"strconv"
)

type IngestionConfig struct {
	Addr               string
	DatabaseURL        string
	AllocatorURL       string
	PromotionThreshold float64
	DefaultPool        string
	DefaultDelta       int
}

const (
	defaultIngestionAddr      = ":8051"
	defaultPromotionThreshold = 0.85
	defaultPromotionPool      = "gpus-us-east"
	defaultPromotionDelta     = 1
)

func LoadIngestion() (IngestionConfig, error) {
	cfg := IngestionConfig{
		Addr:               getEnv("EVAL_ENGINE_ADDR", defaultIngestionAddr),
		DatabaseURL:        firstNonEmpty(os.Getenv("EVAL_ENGINE_DATABASE_URL"), os.Getenv("DATABASE_URL")),
		AllocatorURL:       os.Getenv("RESOURCE_ALLOCATOR_URL"),
		PromotionThreshold: getFloat("EVAL_ENGINE_PROMOTION_THRESHOLD", defaultPromotionThreshold),
		DefaultPool:        getEnv("EVAL_ENGINE_PROMOTION_POOL", defaultPromotionPool),
		DefaultDelta:       getInt("EVAL_ENGINE_PROMOTION_DELTA", defaultPromotionDelta),
	}
	if cfg.DatabaseURL == "" {
		return IngestionConfig{}, fmt.Errorf("DATABASE_URL or EVAL_ENGINE_DATABASE_URL required")
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
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
	if val := os.Getenv(key); val != "" {
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			return f
		}
	}
	return fallback
}

func getInt(key string, fallback int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return fallback
}
