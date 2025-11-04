package signer_test

import (
	"crypto/ed25519"
	"testing"

	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

func TestLocalSigner(t *testing.T) {
	s := signer.NewLocalSigner("test-signer")

	msg := []byte("hello world")
	sig, sid, err := s.Sign(msg)
	if err != nil {
		t.Fatalf("Sign error: %v", err)
	}
	if sid == "" {
		t.Fatalf("expected non-empty signer id")
	}
	pub := s.PublicKey()
	if pub == nil || len(pub) == 0 {
		t.Fatalf("expected public key")
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), msg, sig) {
		t.Fatalf("signature verification failed")
	}
}

