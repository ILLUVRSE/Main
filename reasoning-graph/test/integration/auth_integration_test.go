package integration

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/golang-jwt/jwt/v5"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/config"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/httpserver"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/models"
	"github.com/ILLUVRSE/Main/reasoning-graph/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// MockStore is a mock implementation of store.Store
type MockStore struct {
	mock.Mock
}
func (m *MockStore) Ping(ctx context.Context) error { return nil }
func (m *MockStore) CreateNode(ctx context.Context, input store.NodeInput) (models.ReasonNode, error) {
	return models.ReasonNode{ID: input.ID, Type: input.Type}, nil // Mock response
}
func (m *MockStore) CreateEdge(ctx context.Context, input store.EdgeInput) (models.ReasonEdge, error) { return models.ReasonEdge{}, nil }
func (m *MockStore) GetNode(ctx context.Context, id uuid.UUID) (models.ReasonNode, error) { return models.ReasonNode{}, nil }
func (m *MockStore) ListEdgesTo(ctx context.Context, id uuid.UUID) ([]models.ReasonEdge, error) { return nil, nil }
func (m *MockStore) ListEdgesFrom(ctx context.Context, id uuid.UUID) ([]models.ReasonEdge, error) { return nil, nil }
func (m *MockStore) GetSnapshot(ctx context.Context, id uuid.UUID) (models.ReasonSnapshot, error) { return models.ReasonSnapshot{}, nil }
func (m *MockStore) CreateSnapshot(ctx context.Context, input store.SnapshotInput) (models.ReasonSnapshot, error) { return models.ReasonSnapshot{}, nil }

// Helper to generate RSA keys
func generateKeyPair() (*rsa.PrivateKey, []byte, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, err
	}
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

// Helper to generate self-signed cert with CN
func generateCert(cn string) (*tls.ConnectionState, error) {
	priv, _ := rsa.GenerateKey(rand.Reader, 2048)
	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName: cn,
		},
		NotBefore: time.Now(),
		NotAfter:  time.Now().Add(time.Hour),
		KeyUsage:  x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return nil, err
	}
	cert, err := x509.ParseCertificate(derBytes)
	if err != nil {
		return nil, err
	}
	return &tls.ConnectionState{
		PeerCertificates: []*x509.Certificate{cert},
		HandshakeComplete: true,
	}, nil
}

func TestAuthIntegration(t *testing.T) {
	// Setup Kernel Signer
	privKey, pubKeyPEM, err := generateKeyPair()
	require.NoError(t, err)

	keyFile, err := os.CreateTemp("", "kernel-keys.pem")
	require.NoError(t, err)
	defer os.Remove(keyFile.Name())
	keyFile.Write(pubKeyPEM)
	keyFile.Close()

	// Setup Config
	cfg := config.Config{
		ReasoningAllowMTLS:   true,
		KernelSignerKeysFile: keyFile.Name(),
		KernelTrustedCN:      "kernel-production",
		ReasoningWriteScope:  "reasoning:write",
		ReasoningDevAllowLocal: false,
		// minimal other configs
		MaxNodePayloadBytes: 1024,
	}

	// Setup Server
	mockStore := new(MockStore)
	server := httpserver.New(cfg, mockStore, nil)
	router := server.Router()

	t.Run("Reject Unauthenticated", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/reason/node", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("Accept Kernel Token", func(t *testing.T) {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss":   "kernel",
			"sub":   "test-kernel",
			"scope": "reasoning:write",
			"exp":   time.Now().Add(time.Hour).Unix(),
		})
		tokenStr, _ := token.SignedString(privKey)

		req := httptest.NewRequest("POST", "/reason/node", nil)
		req.Header.Set("Authorization", "Bearer "+tokenStr)
		w := httptest.NewRecorder()

		// We expect 400 because body is empty, but that means it passed auth!
		// If it failed auth, it would be 401/403.
		router.ServeHTTP(w, req)
		assert.NotEqual(t, http.StatusUnauthorized, w.Code)
		assert.NotEqual(t, http.StatusForbidden, w.Code)
	})

	t.Run("Reject Invalid Token Signature", func(t *testing.T) {
		otherKey, _, _ := generateKeyPair()
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss":   "kernel",
			"scope": "reasoning:write",
		})
		tokenStr, _ := token.SignedString(otherKey)

		req := httptest.NewRequest("POST", "/reason/node", nil)
		req.Header.Set("Authorization", "Bearer "+tokenStr)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("Reject Missing Scope", func(t *testing.T) {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss":   "kernel",
			"scope": "reasoning:read", // Wrong scope
		})
		tokenStr, _ := token.SignedString(privKey)

		req := httptest.NewRequest("POST", "/reason/node", nil)
		req.Header.Set("Authorization", "Bearer "+tokenStr)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("Accept mTLS Valid CN", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/reason/node", nil)
		tlsState, err := generateCert("kernel-production")
		require.NoError(t, err)
		req.TLS = tlsState

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		assert.NotEqual(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("Reject mTLS Invalid CN", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/reason/node", nil)
		tlsState, err := generateCert("kernel-fake")
		require.NoError(t, err)
		req.TLS = tlsState

		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}
