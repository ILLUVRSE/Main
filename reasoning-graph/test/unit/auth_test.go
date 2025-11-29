package unit
// Unit tests for auth package

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/auth"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func generateKeyPair() (*rsa.PrivateKey, []byte, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, err
	}

	// Encode public key to PEM
	pubASN1, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return nil, nil, err
	}
	pubBytes := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubASN1,
	})

	return key, pubBytes, nil
}

func TestVerifier(t *testing.T) {
	// Setup keys
	privKey, pubKeyPEM, err := generateKeyPair()
	require.NoError(t, err)

	keyFile, err := os.CreateTemp("", "keys.pem")
	require.NoError(t, err)
	defer os.Remove(keyFile.Name())

	_, err = keyFile.Write(pubKeyPEM)
	require.NoError(t, err)
	keyFile.Close()

	// Config
	cfg := config.Config{
		ReasoningAllowMTLS:   true,
		KernelSignerKeysFile: keyFile.Name(),
		ReasoningWriteScope:  "reasoning:write",
		ReasoningDevAllowLocal: true,
	}

	verifier, err := auth.NewVerifier(cfg)
	require.NoError(t, err)

	t.Run("Token Success", func(t *testing.T) {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss":   "kernel",
			"scope": "reasoning:write",
			"sub":   "test-user",
			"exp":   time.Now().Add(time.Hour).Unix(),
		})

		tokenString, err := token.SignedString(privKey)
		require.NoError(t, err)

		req := httptest.NewRequest("POST", "/nodes", nil)
		req.Header.Set("Authorization", "Bearer "+tokenString)

		err = verifier.VerifyRequest(req)
		assert.NoError(t, err)
	})

	t.Run("Token Missing Scope", func(t *testing.T) {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss":   "kernel",
			"scope": "other:write",
			"sub":   "test-user",
			"exp":   time.Now().Add(time.Hour).Unix(),
		})

		tokenString, err := token.SignedString(privKey)
		require.NoError(t, err)

		req := httptest.NewRequest("POST", "/nodes", nil)
		req.Header.Set("Authorization", "Bearer "+tokenString)

		err = verifier.VerifyRequest(req)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "missing required scope")
	})

	t.Run("Token Invalid Signature", func(t *testing.T) {
		// different key
		privKey2, _, _ := generateKeyPair()
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss":   "kernel",
			"scope": "reasoning:write",
			"sub":   "test-user",
		})
		tokenString, _ := token.SignedString(privKey2)

		req := httptest.NewRequest("POST", "/nodes", nil)
		req.Header.Set("Authorization", "Bearer "+tokenString)

		err = verifier.VerifyRequest(req)
		assert.Error(t, err)
	})

	t.Run("Dev Header", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/nodes", nil)
		req.Header.Set("X-Local-Dev-Principal", "local-dev")

		err := verifier.VerifyRequest(req)
		assert.NoError(t, err)
	})

	t.Run("Dev Header Disabled", func(t *testing.T) {
		cfg2 := cfg
		cfg2.ReasoningDevAllowLocal = false
		v2, _ := auth.NewVerifier(cfg2)

		req := httptest.NewRequest("POST", "/nodes", nil)
		req.Header.Set("X-Local-Dev-Principal", "local-dev")

		err := v2.VerifyRequest(req)
		assert.Error(t, err)
	})
}
