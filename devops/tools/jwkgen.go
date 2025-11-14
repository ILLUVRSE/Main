package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"math/big"
	"os"
	"time"
)

// b64u is base64url no padding
func b64u(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

func must(err error) {
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(2)
	}
}

func main() {
	issuer := flag.String("issuer", "https://test-issuer", "OIDC issuer (iss)")
	aud := flag.String("aud", "signing-api", "OIDC audience (aud)")
	jwksOut := flag.String("jwks-out", "devops/certs/jwks.json", "JWKS output path")
	tokenOut := flag.String("token-out", "devops/certs/test_jwt.txt", "JWT output path")
	expSecs := flag.Int("exp-secs", 600, "token expiry in seconds")
	flag.Parse()

	// Generate RSA key (2048)
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	must(err)
	pub := &priv.PublicKey

	// Marshal public key to derive kid
	pubASN1, err := x509.MarshalPKIXPublicKey(pub)
	must(err)
	sum := sha256.Sum256(pubASN1)
	kid := b64u(sum[:8])

	// n & e in big-endian bytes
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
	jwks := map[string]interface{}{
		"keys": []interface{}{jwk},
	}

	// Ensure output dir
	if err := os.MkdirAll(dirOf(*jwksOut), 0o755); err != nil {
		must(err)
	}

	jwksB, err := json.MarshalIndent(jwks, "", "  ")
	must(err)
	must(os.WriteFile(*jwksOut, jwksB, 0o644))
	fmt.Printf("wrote jwks -> %s (kid=%s)\n", *jwksOut, kid)

	// Build JWT header + payload and sign with RS256
	header := map[string]interface{}{"alg": "RS256", "kid": kid, "typ": "JWT"}
	now := time.Now().Unix()
	payload := map[string]interface{}{
		"iss": *issuer,
		"aud": *aud,
		"exp": now + int64(*expSecs),
		"iat": now,
		"sub": "user-123",
		"realm_access": map[string]interface{}{
			"roles": []string{"SuperAdmin"},
		},
	}

	hb, err := json.Marshal(header)
	must(err)
	pb, err := json.Marshal(payload)
	must(err)

	signingInput := b64u(hb) + "." + b64u(pb)
	hashed := sha256.Sum256([]byte(signingInput))

	sig, err := rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, hashed[:])
	must(err)

	token := signingInput + "." + b64u(sig)

	// Ensure output dir for token
	if err := os.MkdirAll(dirOf(*tokenOut), 0o755); err != nil {
		must(err)
	}
	must(os.WriteFile(*tokenOut, []byte(token+"\n"), 0o600))
	fmt.Printf("wrote token -> %s\n", *tokenOut)
}

// dirOf returns the directory part of a path (or "." if none)
func dirOf(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			if i == 0 {
				return "/"
			}
			return p[:i]
		}
	}
	return "."
}
