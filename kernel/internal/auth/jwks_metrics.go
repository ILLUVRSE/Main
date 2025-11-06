package auth

import (
	"log"
	"sync"
	"time"
)

// JWKSMetricsSnapshot is a read-only snapshot of JWKS metrics.
type JWKSMetricsSnapshot struct {
	FetchCount int64     // number of successful fetches observed
	FailCount  int64     // number of fetch failures observed
	LastFetch  time.Time // timestamp of last successful fetch
	LastError  string    // last observed fetch error (empty if none)
}

// JWKSMetrics keeps counters and last-state for a JWKSCache.
type JWKSMetrics struct {
	mu sync.RWMutex

	FetchCount int64
	FailCount  int64
	LastFetch  time.Time
	LastError  string

	// prevFetch used internally to detect new fetch events from the cache.
	prevFetch time.Time
}

// global metrics instance (simple singleton for now)
var jwksMetrics = &JWKSMetrics{}

// UpdateJWKSMetricsFromCache reads the JWKSCache status and updates the metrics.
// It's safe to call concurrently.
func UpdateJWKSMetricsFromCache(j *JWKSCache) {
	if j == nil {
		return
	}
	lf := j.LastFetch()
	le := j.LastError()

	jwksMetrics.mu.Lock()
	defer jwksMetrics.mu.Unlock()

	// If the cache reports a newer successful fetch time, count it.
	if !lf.IsZero() && lf.After(jwksMetrics.prevFetch) {
		jwksMetrics.FetchCount++
		jwksMetrics.prevFetch = lf
		jwksMetrics.LastFetch = lf
	}

	// Record failures. We count failure events each time LastError() is non-nil.
	if le != nil {
		jwksMetrics.FailCount++
		jwksMetrics.LastError = le.Error()
	} else {
		// Clear last error if none now
		jwksMetrics.LastError = ""
	}
}

// StartJWKSMetricsUpdater starts a background goroutine that periodically reads
// metrics from the provided JWKSCache and updates the in-memory counters.
//
// It returns a stop function which when called will stop the goroutine.
func StartJWKSMetricsUpdater(j *JWKSCache, interval time.Duration) (stop func()) {
	if j == nil {
		log.Printf("[jwks.metrics] StartJWKSMetricsUpdater called with nil JWKSCache")
		return func() {}
	}
	if interval <= 0 {
		interval = 10 * time.Second
	}

	// Do an immediate update first.
	UpdateJWKSMetricsFromCache(j)

	ticker := time.NewTicker(interval)
	stopCh := make(chan struct{})
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				UpdateJWKSMetricsFromCache(j)
			case <-stopCh:
				return
			}
		}
	}()

	return func() {
		close(stopCh)
	}
}

// GetJWKSMetrics returns a snapshot of the current JWKS metrics.
func GetJWKSMetrics() JWKSMetricsSnapshot {
	jwksMetrics.mu.RLock()
	defer jwksMetrics.mu.RUnlock()
	return JWKSMetricsSnapshot{
		FetchCount: jwksMetrics.FetchCount,
		FailCount:  jwksMetrics.FailCount,
		LastFetch:  jwksMetrics.LastFetch,
		LastError:  jwksMetrics.LastError,
	}
}

// ResetJWKSMetrics resets counters and state (useful for tests).
func ResetJWKSMetrics() {
	jwksMetrics.mu.Lock()
	defer jwksMetrics.mu.Unlock()
	jwksMetrics.FetchCount = 0
	jwksMetrics.FailCount = 0
	jwksMetrics.LastFetch = time.Time{}
	jwksMetrics.LastError = ""
	jwksMetrics.prevFetch = time.Time{}
}
