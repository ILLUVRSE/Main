package signer

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
)

// Signer defines the minimal signing abstraction used by the Kernel bootstrap.
type Signer interface {
	// Sign signs the provided hash bytes and returns (signature, signerId, error).
	Sign(hash []byte) (sig []byte, signerId string, err error)

	// PublicKey returns the public key bytes for verification (nil if not supported).
	PublicKey() []byte
}

// LocalSigner is a simple in-process Ed25519 signer for development and testing only.
// DO NOT use LocalSigner in production.
type LocalSigner struct {
	priv     ed25519.PrivateKey
	pub      ed25519.PublicKey
	signerId string
}

// NewLocalSigner creates a new LocalSigner and generates an Ed25519 keypair.
// signerId is a logical identifier for the signer (e.g. "local-signer-1").
func NewLocalSigner(signerId string) *LocalSigner {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		// Generation should not fail in normal environments; panic to surface early.
		panic(err)
	}
	return &LocalSigner{
		priv:     priv,
		pub:      pub,
		signerId: signerId,
	}
}

// Sign implements Signer.Sign by signing the provided hash using Ed25519.
func (l *LocalSigner) Sign(hash []byte) ([]byte, string, error) {
	if l.priv == nil {
		return nil, "", errors.New("local signer: private key not initialized")
	}
	sig := ed25519.Sign(l.priv, hash)
	return sig, l.signerId, nil
}

// PublicKey returns the Ed25519 public key bytes.
func (l *LocalSigner) PublicKey() []byte {
	return l.pub
}
