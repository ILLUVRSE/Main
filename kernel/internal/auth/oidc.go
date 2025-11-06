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
	"log"
	"net/http"
	"strconv"
	"strings"
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

// getKeyFromCache retrieves the rsa.PublicKey for the given kid from the provided JWKSCache.
// This function adapts the generic crypto.PublicKey returned by JWKSCache.GetKey into *rsa.PublicKey.
func getKeyFromCache(jwks *JWKSCache, kid string) (*rsa.PublicKey, error) {
	if jwks == nil {
		return nil, fmt.Errorf("jwks cache is nil")
	}
	key, err := jwks.GetKey(kid)
	if err != nil {
		return nil, fmt.Errorf("get jwk key: %w", err)
	}
	pub, ok := key.(*rsa.PublicKey)
	if !ok {
		return nil, fmt.Errorf("jwks: key %s is not rsa", kid)
	}
	return pub, nil
}

// ValidateJWT validates an RS256 JWT token using the JWKS cache.
// Returns the claims map and roles extracted from it.
func ValidateJWT(ctx context.Context, token string, jwks *JWKSCache, issuer string, audience string) (map[string]interface{}, []string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, nil, errors.New("token must have 3 parts")
	}

	// header
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

	// find key
	pub, err := getKeyFromCache(jwks, kidVal)
	if err != nil {
		return nil, nil, fmt.Errorf("get jwk key: %w", err)
	}

	// payload
	payloadB, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, nil, fmt.Errorf("decode payload: %w", err)
	}
	var claims map[string]interface{}
	if err := json.Unmarshal(payloadB, &claims); err != nil {
		return nil, nil, fmt.Errorf("unmarshal claims: %w", err)
	}

	// signature verification
	signatureB, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, nil, fmt.Errorf("decode signature: %w", err)
	}
	signingInput := []byte(parts[0] + "." + parts[1])
	hash := sha256.Sum256(signingInput)
	if err := rsaVerify(pub, hash[:], signatureB); err != nil {
		return nil, nil, fmt.Errorf("signature verification failed: %w", err)
	}

	// Validate claims: exp, nbf, iss, aud
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

// extractRolesFromClaims attempts to find roles in common claim locations.
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

// OIDCMiddleware validates Bearer token (if present) and populates Roles on AuthInfo.
func OIDCMiddleware(jwks *JWKSCache, issuer, audience string) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ai := FromContext(r.Context())
			if ai == nil {
				ai = &AuthInfo{}
				ctx := context.WithValue(r.Context(), ctxKeyAuthInfo, ai)
				r = r.WithContext(ctx)
			}
			// Prefer Bearer token from AuthInfo or header
			token := ai.BearerToken
			if token == "" {
				ah := r.Header.Get("Authorization")
				if strings.HasPrefix(strings.ToLower(ah), "bearer ") {
					token = strings.TrimSpace(ah[len("bearer "):])
				}
			}
			if token == "" {
				next.ServeHTTP(w, r)
				return
			}

			// Validate token and log failures for diagnosis.
			_, roles, err := ValidateJWT(r.Context(), token, jwks, issuer, audience)
			if err != nil {
				var jerr error
				if jwks != nil {
					jerr = jwks.LastError()
				}
				log.Printf("[oidc] token validation failed: %v jwks.last_err=%v", err, jerr)
				next.ServeHTTP(w, r)
				return
			}

			ai.Roles = roles
			next.ServeHTTP(w, r)
		})
	}
}

