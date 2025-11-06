package auth

import (
	"crypto"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"math/big"
	"net/http"
	"sync"
	"time"
)

// JWKSCache fetches and caches a JWKS document. It provides thread-safe lookups and
// automatically refreshes when the TTL expires or on cache miss.
type JWKSCache struct {
	url string
	ttl time.Duration

	mu        sync.RWMutex
	keys      map[string]crypto.PublicKey
	lastFetch time.Time
	lastErr   error
	client    *http.Client
}

// NewJWKSCache constructs a JWKSCache, performs an initial fetch (best-effort),
// and returns the instance. Callers may call Refresh() to force a refresh.
func NewJWKSCache(jwksURL string, ttl time.Duration) *JWKSCache {
	if ttl <= 0 {
		ttl = 300 * time.Second
	}
	j := &JWKSCache{
		url:    jwksURL,
		ttl:    ttl,
		keys:   make(map[string]crypto.PublicKey),
		client: &http.Client{Timeout: 5 * time.Second},
	}
	// best-effort initial fetch
	if err := j.Refresh(); err != nil {
		log.Printf("[jwks] initial jwks fetch failed: %v", err)
	}
	return j
}

// Refresh forces a reload of the JWKS from the configured URL. It returns an error
// if the fetch or parse fails. Success updates the in-memory map and timestamps.
func (j *JWKSCache) Refresh() error {
	if j.url == "" {
		return errors.New("jwks url empty")
	}
	req, err := http.NewRequest("GET", j.url, nil)
	if err != nil {
		j.setLastError(err)
		return err
	}
	// small user-agent so remote servers have context
	req.Header.Set("User-Agent", "ILLUVRSE-JWKS-Cache/1.0")

	resp, err := j.client.Do(req)
	if err != nil {
		j.setLastError(err)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		err := errors.New("jwks fetch returned status " + resp.Status)
		j.setLastError(err)
		return err
	}

	var doc struct {
		Keys []map[string]interface{} `json:"keys"`
	}
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&doc); err != nil {
		j.setLastError(err)
		return err
	}

	newKeys := make(map[string]crypto.PublicKey)
	for _, k := range doc.Keys {
		// Expect kty, kid, n, e
		kty, _ := k["kty"].(string)
		if kty != "RSA" {
			// skip non-RSA for now
			continue
		}
		kid, _ := k["kid"].(string)
		nb64, _ := k["n"].(string)
		eb64, _ := k["e"].(string)
		if kid == "" || nb64 == "" || eb64 == "" {
			continue
		}
		nBytes, err := base64.RawURLEncoding.DecodeString(nb64)
		if err != nil {
			log.Printf("[jwks] decode n for kid=%s failed: %v", kid, err)
			continue
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(eb64)
		if err != nil {
			log.Printf("[jwks] decode e for kid=%s failed: %v", kid, err)
			continue
		}
		n := new(big.Int).SetBytes(nBytes)
		e := 0
		// eBytes is big-endian integer (usually small)
		for _, b := range eBytes {
			e = e<<8 + int(b)
		}
		if e == 0 {
			log.Printf("[jwks] invalid exponent for kid=%s", kid)
			continue
		}
		pub := &rsa.PublicKey{N: n, E: e}
		// sanity-check: marshal/unmarshal via x509 to ensure valid key
		if _, err := x509.MarshalPKIXPublicKey(pub); err != nil {
			log.Printf("[jwks] public key marshal failed for kid=%s: %v", kid, err)
			continue
		}
		newKeys[kid] = pub
	}

	j.mu.Lock()
	j.keys = newKeys
	j.lastFetch = time.Now().UTC()
	j.lastErr = nil
	j.mu.Unlock()

	log.Printf("[jwks] refreshed %d keys from %s (ttl=%s)", len(newKeys), j.url, j.ttl)
	return nil
}

// GetKey returns the public key for the given kid. If the key isn't present and
// the cache has expired, it triggers a Refresh and retries once.
func (j *JWKSCache) GetKey(kid string) (crypto.PublicKey, error) {
	// fast read lock
	j.mu.RLock()
	// if unexpired and key present, return
	if time.Since(j.lastFetch) <= j.ttl {
		if k, ok := j.keys[kid]; ok {
			j.mu.RUnlock()
			return k, nil
		}
	}
	j.mu.RUnlock()

	// If cache still fresh but key missing, try a best-effort background refresh with short timeout.
	// We'll do an immediate refresh (synchronous) for correctness.
	if err := j.Refresh(); err != nil {
		// return best-known error
		j.mu.RLock()
		le := j.lastErr
		j.mu.RUnlock()
		if le != nil {
			return nil, le
		}
		// fallback error
		return nil, err
	}

	j.mu.RLock()
	defer j.mu.RUnlock()
	if k, ok := j.keys[kid]; ok {
		return k, nil
	}
	return nil, errors.New("key not found")
}

// LastFetch returns the last successful fetch time for diagnostics.
func (j *JWKSCache) LastFetch() time.Time {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.lastFetch
}

// LastError returns the last fetch error (if any).
func (j *JWKSCache) LastError() error {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.lastErr
}

func (j *JWKSCache) setLastError(err error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.lastErr = err
}
