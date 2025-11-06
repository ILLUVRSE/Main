package auth

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// b64u encodes bytes to base64url without padding.
func b64u(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

func makeJWK(pub *rsa.PublicKey) (map[string]interface{}, string, error) {
	pubASN1, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(pubASN1)
	kid := b64u(sum[:8])

	n := pub.N.Bytes()
	e := big.NewInt(int64(pub.E)).Bytes()

	jwk := map[string]interface{}{
		"kty": "RSA",
		"kid": kid,
		"alg": "RS256",
		"use": "sig",
		"n":   b64u(n),
		"e":   b64u(e),
	}
	return jwk, kid, nil
}

func makeJWKSJSON(keys []map[string]interface{}) ([]byte, error) {
	doc := map[string]interface{}{
		"keys": keys,
	}
	return json.MarshalIndent(doc, "", "  ")
}

func signTokenRS256(priv *rsa.PrivateKey, kid string, iss, aud string, roles []string, exp time.Time) (string, error) {
	header := map[string]interface{}{"alg": "RS256", "kid": kid, "typ": "JWT"}
	now := time.Now().Unix()
	payload := map[string]interface{}{
		"iss": iss,
		"aud": aud,
		"exp": exp.Unix(),
		"iat": now,
		"sub": "user-123",
		"realm_access": map[string]interface{}{
			"roles": roles,
		},
	}
	hb, _ := json.Marshal(header)
	pb, _ := json.Marshal(payload)
	signingInput := b64u(hb) + "." + b64u(pb)
	hashed := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, hashed[:])
	if err != nil {
		return "", err
	}
	return signingInput + "." + b64u(sig), nil
}

func TestValidateJWT_HappyPath(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwk, kid, err := makeJWK(&priv.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	jwksB, err := makeJWKSJSON([]map[string]interface{}{jwk})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(jwksB)
	}))
	defer srv.Close()

	iss := "https://test-issuer"
	aud := "signing-api"
	token, err := signTokenRS256(priv, kid, iss, aud, []string{"SuperAdmin"}, time.Now().Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}

	cache := NewJWKSCache(srv.URL, 60*time.Second)
	claims, roles, err := ValidateJWT(nil, token, cache, iss, aud)
	if err != nil {
		t.Fatalf("ValidateJWT failed: %v", err)
	}
	if claims["iss"] != iss {
		t.Fatalf("unexpected iss claim: %v", claims["iss"])
	}
	found := false
	for _, r := range roles {
		if r == "SuperAdmin" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected SuperAdmin role in roles: %v", roles)
	}
}

func TestValidateJWT_ExpiredToken(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwk, kid, err := makeJWK(&priv.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	jwksB, _ := makeJWKSJSON([]map[string]interface{}{jwk})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(jwksB)
	}))
	defer srv.Close()

	iss := "https://test-issuer"
	aud := "signing-api"
	token, err := signTokenRS256(priv, kid, iss, aud, []string{"SuperAdmin"}, time.Now().Add(-1*time.Minute))
	if err != nil {
		t.Fatal(err)
	}

	cache := NewJWKSCache(srv.URL, 60*time.Second)
	_, _, err = ValidateJWT(nil, token, cache, iss, aud)
	if err == nil || !strings.Contains(err.Error(), "token expired") {
		t.Fatalf("expected token expired error, got: %v", err)
	}
}

func TestValidateJWT_UnknownKid(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	priv2, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwk2, _, _ := makeJWK(&priv2.PublicKey)
	jwksB, _ := makeJWKSJSON([]map[string]interface{}{jwk2})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(jwksB)
	}))
	defer srv.Close()

	// token signed with priv (kid derived from priv). we don't need jwk here.
	_, kid, _ := makeJWK(&priv.PublicKey)
	token, err := signTokenRS256(priv, kid, "https://test-issuer", "signing-api", []string{"SuperAdmin"}, time.Now().Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}

	cache := NewJWKSCache(srv.URL, 60*time.Second)
	_, _, err = ValidateJWT(nil, token, cache, "https://test-issuer", "signing-api")
	if err == nil {
		t.Fatalf("expected error for unknown kid, got nil")
	}
	if !strings.Contains(err.Error(), "get jwk key") && !strings.Contains(err.Error(), "key not found") {
		t.Fatalf("unexpected error for unknown kid: %v", err)
	}
}

func TestJWKSRotation(t *testing.T) {
	priv1, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	priv2, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwk1, kid1, _ := makeJWK(&priv1.PublicKey)
	jwk2, kid2, _ := makeJWK(&priv2.PublicKey)

	current := jwk1
	ch := make(chan struct{}, 1)
	ch <- struct{}{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-ch:
			b, _ := makeJWKSJSON([]map[string]interface{}{current})
			w.Write(b)
			ch <- struct{}{}
		default:
			b, _ := makeJWKSJSON([]map[string]interface{}{current})
			w.Write(b)
		}
	}))
	defer srv.Close()

	iss := "https://test-issuer"
	aud := "signing-api"
	tok1, err := signTokenRS256(priv1, kid1, iss, aud, []string{"SuperAdmin"}, time.Now().Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	tok2, err := signTokenRS256(priv2, kid2, iss, aud, []string{"SuperAdmin"}, time.Now().Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}

	cache := NewJWKSCache(srv.URL, 1*time.Second)
	if _, _, err := ValidateJWT(nil, tok1, cache, iss, aud); err != nil {
		t.Fatalf("expected tok1 to validate initially: %v", err)
	}

	<-ch
	current = jwk2
	ch <- struct{}{}
	time.Sleep(1200 * time.Millisecond)

	if _, _, err := ValidateJWT(nil, tok1, cache, iss, aud); err == nil {
		t.Fatalf("expected tok1 to fail after rotation")
	}
	if _, _, err := ValidateJWT(nil, tok2, cache, iss, aud); err != nil {
		t.Fatalf("expected tok2 to validate after rotation: %v", err)
	}
}
