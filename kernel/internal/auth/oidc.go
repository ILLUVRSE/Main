package auth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Minimal JWK subset for RSA keys we need.
type jwkKey struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// jwks document
type jwksDoc struct {
	Keys []jwkKey `json:"keys"`
}

// JWKSCache fetches and caches JWKS keys.
// It supports only RSA keys (kty == "RSA") used with RS256.
type JWKSCache struct {
	url    string
	ttl    time.Duration
	mu     sync.RWMutex
	keys   map[string]*rsa.PublicKey
	expiry time.Time
	client *http.Client
}

// NewJWKSCache constructs a JWKSCache that will fetch from jwksURL and cache keys for ttl.
func NewJWKSCache(jwksURL string, ttl time.Duration) *JWKSCache {
	return &JWKSCache{
		url:    jwksURL,
		ttl:    ttl,
		keys:   make(map[string]*rsa.PublicKey),
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// getKey returns the RSA public key for kid, refreshing the cache if needed.
func (c *JWKSCache) getKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	// fast path: read lock
	c.mu.RLock()
	if key, ok := c.keys[kid]; ok && time.Now().Before(c.expiry) {
		c.mu.RUnlock()
		return key, nil
	}
	c.mu.RUnlock()

	// refresh
	if err := c.refresh(ctx); err != nil {
		return nil, err
	}

	c.mu.RLock()
	defer c.mu.RUnlock()
	key, ok := c.keys[kid]
	if !ok {
		return nil, fmt.Errorf("kid %s not found in jwks", kid)
	}
	return key, nil
}

// refresh downloads the JWKS document and populates keys.
func (c *JWKSCache) refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch jwks: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("jwks endpoint returned %d", resp.StatusCode)
	}
	var doc jwksDoc
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&doc); err != nil {
		return fmt.Errorf("decode jwks: %w", err)
	}
	tmp := make(map[string]*rsa.PublicKey)
	for _, k := range doc.Keys {
		if strings.ToUpper(k.Kty) != "RSA" {
			// skip non-RSA keys in this simple implementation
			continue
		}
		nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
		if err != nil {
			return fmt.Errorf("decode n for kid %s: %w", k.Kid, err)
		}
		eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
		if err != nil {
			return fmt.Errorf("decode e for kid %s: %w", k.Kid, err)
		}
		// e is typically small (65537). Interpret big-endian bytes
		e := 0
		for _, by := range eBytes {
			e = e<<8 + int(by)
		}
		if e == 0 {
			// fallback: try big.Int
			ebi := new(big.Int).SetBytes(eBytes)
			e = int(ebi.Int64())
		}
		pub := &rsa.PublicKey{
			N: new(big.Int).SetBytes(nBytes),
			E: e,
		}
		tmp[k.Kid] = pub
	}

	c.mu.Lock()
	c.keys = tmp
	c.expiry = time.Now().Add(c.ttl)
	c.mu.Unlock()
	return nil
}

// ValidateJWT validates a RS256 JWT token using the JWKS cache. It validates:
// - signature
// - exp > now
// - iss == issuer (if provided)
// - aud contains audience (if provided)
// On success it returns the claims map and the roles extracted (if any).
func ValidateJWT(ctx context.Context, token string, jwks *JWKSCache, issuer string, audience string) (map[string]interface{}, []string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, nil, errors.New("token must have 3 parts")
	}
	headerB, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, nil, fmt.Errorf("decode header: %w", err)
	}
	var hdr map[string]interface{}
	if err := json.Unmarshal(headerB, &hdr); err != nil {
		return nil, nil, fmt.Errorf("unmarshal header: %w", err)
	}
	kidVal, _ := hdr["kid"].(string)
	algVal, _ := hdr["alg"].(string)
	if algVal != "RS256" {
		return nil, nil, fmt.Errorf("unsupported alg %s", algVal)
	}
	// get key
	pub, err := jwks.getKey(ctx, kidVal)
	if err != nil {
		return nil, nil, fmt.Errorf("get jwk key: %w", err)
	}

	// decode payload
	payloadB, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, nil, fmt.Errorf("decode payload: %w", err)
	}
	var claims map[string]interface{}
	if err := json.Unmarshal(payloadB, &claims); err != nil {
		return nil, nil, fmt.Errorf("unmarshal claims: %w", err)
	}

	// verify signature: verify rsa PKCS1v15 with SHA256 over signing input
	signatureB, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, nil, fmt.Errorf("decode signature: %w", err)
	}
	signingInput := []byte(parts[0] + "." + parts[1])
	hash := sha256.Sum256(signingInput)
	if err := rsaVerify(pub, hash[:], signatureB); err != nil {
		return nil, nil, fmt.Errorf("signature verification failed: %w", err)
	}

	// Validate claims: exp, nbf (opt), iss, aud
	now := time.Now().Unix()
	if expV, ok := claims["exp"]; ok {
		expFloat, okf := toFloat64(expV)
		if !okf {
			return nil, nil, fmt.Errorf("invalid exp claim type")
		}
		if int64(expFloat) <= now {
			return nil, nil, fmt.Errorf("token expired")
		}
	}
	if nbfV, ok := claims["nbf"]; ok {
		nbfFloat, okf := toFloat64(nbfV)
		if okf {
			if int64(nbfFloat) > now {
				return nil, nil, fmt.Errorf("token not yet valid (nbf)")
			}
		}
	}
	if issuer != "" {
		if issV, ok := claims["iss"]; ok {
			if issStr, ok2 := issV.(string); ok2 {
				if issStr != issuer {
					return nil, nil, fmt.Errorf("issuer mismatch: expected %s got %s", issuer, issStr)
				}
			}
		}
	}
	if audience != "" {
		if audV, ok := claims["aud"]; ok {
			if okAud(audV, audience) == false {
				return nil, nil, fmt.Errorf("audience %s not present", audience)
			}
		}
	}

	roles := extractRolesFromClaims(claims)
	return claims, roles, nil
}

func rsaVerify(pub *rsa.PublicKey, hash []byte, sig []byte) error {
	// Use crypto.SHA256
	return rsa.VerifyPKCS1v15(pub, crypto.SHA256, hash, sig)
}

func toFloat64(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case json.Number:
		f, err := x.Float64()
		if err == nil {
			return f, true
		}
		return 0, false
	case string:
		// try parse
		if f, err := strconv.ParseFloat(x, 64); err == nil {
			return f, true
		}
		return 0, false
	default:
		return 0, false
	}
}

func okAud(aud interface{}, expected string) bool {
	switch x := aud.(type) {
	case string:
		return x == expected
	case []interface{}:
		for _, v := range x {
			if s, ok := v.(string); ok && s == expected {
				return true
			}
		}
	}
	return false
}

// extractRolesFromClaims attempts to find roles in common claim locations:
// - "roles" claim (array of strings)
// - "realm_access.roles" (Keycloak style)
// - "resource_access.<client>.roles" (Keycloak)
// - "scope" (space-separated string) -> treat as roles
func extractRolesFromClaims(claims map[string]interface{}) []string {
	out := make([]string, 0)
	// direct roles
	if r, ok := claims["roles"]; ok {
		if arr, ok2 := r.([]interface{}); ok2 {
			for _, v := range arr {
				if s, ok3 := v.(string); ok3 {
					out = append(out, s)
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	// realm_access.roles
	if ra, ok := claims["realm_access"]; ok {
		if ram, ok2 := ra.(map[string]interface{}); ok2 {
			if rr, ok3 := ram["roles"]; ok3 {
				if arr, ok4 := rr.([]interface{}); ok4 {
					for _, v := range arr {
						if s, ok5 := v.(string); ok5 {
							out = append(out, s)
						}
					}
				}
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	// resource_access -> client -> roles
	if ra, ok := claims["resource_access"]; ok {
		if ram, ok2 := ra.(map[string]interface{}); ok2 {
			for _, v := range ram {
				if vm, ok3 := v.(map[string]interface{}); ok3 {
					if rr, ok4 := vm["roles"]; ok4 {
						if arr, ok5 := rr.([]interface{}); ok5 {
							for _, rv := range arr {
								if s, ok6 := rv.(string); ok6 {
									out = append(out, s)
								}
							}
						}
					}
				}
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	// scope as space-separated
	if sc, ok := claims["scope"]; ok {
		if s, ok2 := sc.(string); ok2 {
			for _, tok := range strings.Split(s, " ") {
				tok = strings.TrimSpace(tok)
				if tok != "" {
					out = append(out, tok)
				}
			}
		}
	}
	return out
}

// OIDCMiddleware returns a middleware that will validate a Bearer token (if present)
// and populate the Roles on the request's AuthInfo. It does NOT overwrite PeerCN.
func OIDCMiddleware(jwks *JWKSCache, issuer, audience string) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ai := FromContext(r.Context())
			if ai == nil {
				// ensure we have an AuthInfo in context
				ai = &AuthInfo{}
				ctx := context.WithValue(r.Context(), ctxKeyAuthInfo, ai)
				r = r.WithContext(ctx)
			}
			// prefer token in AuthInfo (populated by auth middleware) but also check header
			token := ai.BearerToken
			if token == "" {
				if authz := r.Header.Get("Authorization"); strings.HasPrefix(strings.ToLower(authz), "bearer ") {
					token = strings.TrimSpace(authz[7:])
				}
			}
			if token == "" {
				// no token — proceed without roles
				next.ServeHTTP(w, r)
				return
			}
			claims, roles, err := ValidateJWT(r.Context(), token, jwks, issuer, audience)
			if err != nil {
				http.Error(w, "invalid token: "+err.Error(), http.StatusUnauthorized)
				return
			}
			// attach roles and claims to AuthInfo
			ai.Roles = roles
			// Optionally store claims somewhere (not part of AuthInfo for now)
			_ = claims
			next.ServeHTTP(w, r)
		})
	}
}

