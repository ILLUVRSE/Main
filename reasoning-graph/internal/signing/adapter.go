package signing

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// InMemorySigner is a test adapter that generates ephemeral keys.
type InMemorySigner struct {
	mu         sync.Mutex
	privateKey ed25519.PrivateKey
	publicKey  ed25519.PublicKey
	kid        string
	dumpPath   string
}

func NewInMemorySigner(dumpPath string) (*InMemorySigner, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}

	s := &InMemorySigner{
		privateKey: priv,
		publicKey:  pub,
		kid:        "test-signer-1",
		dumpPath:   dumpPath,
	}

	if err := s.dumpPublicKeys(); err != nil {
		return nil, err
	}

	return s, nil
}

func (s *InMemorySigner) Sign(ctx context.Context, data []byte) (string, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	sig := ed25519.Sign(s.privateKey, data)
	return base64.StdEncoding.EncodeToString(sig), s.kid, nil
}

func (s *InMemorySigner) dumpPublicKeys() error {
	// Convert public key to SPKI DER then PEM/Base64
	// Kernel uses SPKI.

	// ed25519.PublicKey is just bytes.
	// We need to marshal it to PKIX/SPKI.

	spkiBytes, err := x509.MarshalPKIXPublicKey(s.publicKey)
	if err != nil {
		return err
	}

	spkiBase64 := base64.StdEncoding.EncodeToString(spkiBytes)

	// Create the JSON structure expected by verification tests
	type SignerEntry struct {
		PublicKey string `json:"publicKey"`
		KID       string `json:"kid"`
	}

	data := map[string]SignerEntry{
		s.kid: {
			PublicKey: spkiBase64,
			KID:       s.kid,
		},
	}

	bytes, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	// Ensure directory exists
	dir := filepath.Dir(s.dumpPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	return os.WriteFile(s.dumpPath, bytes, 0644)
}
