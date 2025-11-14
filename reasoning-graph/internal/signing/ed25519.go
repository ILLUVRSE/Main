package signing

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
)

// Signer defines the minimal contract for creating signatures.
type Signer interface {
	Sign(ctx context.Context, payload []byte) ([]byte, error)
	SignerID() string
}

type Ed25519Signer struct {
	privateKey ed25519.PrivateKey
	signerID   string
}

func NewEd25519SignerFromB64(b64Key, signerID string) (*Ed25519Signer, error) {
	keyBytes, err := base64.StdEncoding.DecodeString(b64Key)
	if err != nil {
		return nil, fmt.Errorf("decode signer private key: %w", err)
	}
	if len(keyBytes) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("invalid ed25519 private key length: got %d want %d", len(keyBytes), ed25519.PrivateKeySize)
	}
	return &Ed25519Signer{
		privateKey: ed25519.PrivateKey(keyBytes),
		signerID:   signerID,
	}, nil
}

func (s *Ed25519Signer) Sign(ctx context.Context, payload []byte) ([]byte, error) {
	// Context currently unused but reserved for future remote signers.
	_ = ctx
	sig := ed25519.Sign(s.privateKey, payload)
	return sig, nil
}

func (s *Ed25519Signer) SignerID() string {
	return s.signerID
}
