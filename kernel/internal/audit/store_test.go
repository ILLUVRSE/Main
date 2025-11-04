package audit_test

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ILLUVRSE/Main/kernel/internal/audit"
	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

func TestFileStoreAppendGet(t *testing.T) {
	dir := t.TempDir()
	store := audit.NewFileStore(dir)
	s := signer.NewLocalSigner("test-signer")

	// Insert a manifest signature (basic smoke)
	ms := &audit.ManifestSignature{
		ManifestId: "m-manifest-1",
		SignerId:   "test-signer",
		Signature:  base64.StdEncoding.EncodeToString([]byte("dummy")),
		Version:    "v1",
		Ts:         time.Now().UTC(),
	}
	if err := store.InsertManifestSignature(context.Background(), ms); err != nil {
		t.Fatalf("InsertManifestSignature error: %v", err)
	}

	// Append an audit event
	ev := &audit.AuditEvent{
		EventType: "test.event",
		Payload: map[string]interface{}{
			"foo": "bar",
		},
		Ts: time.Now().UTC(),
	}

	if err := store.AppendAuditEvent(context.Background(), ev, s); err != nil {
		t.Fatalf("AppendAuditEvent error: %v", err)
	}

	// head.hash should exist and be non-empty
	headPath := filepath.Join(dir, "head.hash")
	headB, err := os.ReadFile(headPath)
	if err != nil {
		t.Fatalf("read head.hash: %v", err)
	}
	if len(headB) == 0 {
		t.Fatalf("head.hash empty")
	}

	// Get the event by ID (AppendAuditEvent should set ev.ID)
	if ev.ID == "" {
		t.Fatalf("expected ev.ID set by AppendAuditEvent")
	}
	got, err := store.GetAuditEvent(context.Background(), ev.ID)
	if err != nil {
		t.Fatalf("GetAuditEvent error: %v", err)
	}
	if got.EventType != ev.EventType {
		t.Fatalf("event type mismatch: want %s got %s", ev.EventType, got.EventType)
	}
	if got.Signature == "" {
		t.Fatalf("expected signature in stored event")
	}
	if got.Hash == "" {
		t.Fatalf("expected hash in stored event")
	}

	// Verify signature using signer's public key
	pub := s.PublicKey()
	if pub == nil {
		t.Fatalf("signer public key nil")
	}
	sigBytes, err := base64.StdEncoding.DecodeString(got.Signature)
	if err != nil {
		t.Fatalf("invalid signature base64: %v", err)
	}
	// decode stored hash hex
	hashBytes, err := hexDecode(got.Hash)
	if err != nil {
		t.Fatalf("invalid hash hex: %v", err)
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), hashBytes, sigBytes) {
		t.Fatalf("signature verification failed")
	}
}

// hexDecode decodes a hex string to bytes.
func hexDecode(s string) ([]byte, error) {
	return hex.DecodeString(s)
}

