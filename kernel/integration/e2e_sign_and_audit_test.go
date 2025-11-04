package integration_test

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"testing"
	"time"

	"github.com/ILLUVRSE/Main/kernel/internal/audit"
	"github.com/ILLUVRSE/Main/kernel/internal/canonical"
	"github.com/ILLUVRSE/Main/kernel/internal/keys"
	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

// sha256Sum helper
func sha256Sum(b []byte) []byte {
	s := sha256.Sum256(b)
	return s[:]
}

// This integration test runs with the FileStore (no DB). It:
// 1) creates a local signer and registers it in a Key Registry
// 2) signs a manifest and inserts a manifest signature via FileStore
// 3) appends an audit event with FileStore
// 4) reads the stored event and recomputes the hash and verifies the signature using the registry
func TestE2ESignAndAudit_FileStore(t *testing.T) {
	// Setup
	dir := t.TempDir()
	store := audit.NewFileStore(dir)
	s := signer.NewLocalSigner("int-signer-1")

	// Key registry and register signer public key
	reg := keys.NewRegistry()
	reg.AddSigner("int-signer-1", s.PublicKey(), "Ed25519")

	// 1) Sign a manifest and persist manifest signature
	manifest := map[string]interface{}{
		"id":    "dvg-int-1",
		"name":  "IntegrationDivision",
		"goals": []string{"test"},
	}
	canon, err := canonical.MarshalCanonical(manifest)
	if err != nil {
		t.Fatalf("canonical.MarshalCanonical: %v", err)
	}
	sum := sha256Sum(canon)
	sig, signerId, err := s.Sign(sum)
	if err != nil {
		t.Fatalf("signer.Sign error: %v", err)
	}
	ms := &audit.ManifestSignature{
		ManifestId: "dvg-int-1",
		SignerId:   signerId,
		Signature:  base64.StdEncoding.EncodeToString(sig),
		Version:    "1.0",
		Ts:         time.Now().UTC(),
	}
	if err := store.InsertManifestSignature(context.Background(), ms); err != nil {
		t.Fatalf("InsertManifestSignature: %v", err)
	}

	// 2) Append an audit event
	ev := &audit.AuditEvent{
		EventType: "integration.test",
		Payload: map[string]interface{}{
			"note":     "integration check",
			"manifest": manifest,
		},
		Ts: time.Now().UTC(),
	}
	if err := store.AppendAuditEvent(context.Background(), ev, s); err != nil {
		t.Fatalf("AppendAuditEvent: %v", err)
	}

	// 3) Retrieve and verify event
	got, err := store.GetAuditEvent(context.Background(), ev.ID)
	if err != nil {
		t.Fatalf("GetAuditEvent: %v", err)
	}
	// recompute canonical and hash
	canonPayload, err := canonical.MarshalCanonical(got.Payload)
	if err != nil {
		t.Fatalf("canonicalize got payload: %v", err)
	}
	// build concat = canonical || prevHashBytes
	var concat []byte
	concat = append(concat, canonPayload...)
	if got.PrevHash != "" {
		prevBytes, err := hex.DecodeString(got.PrevHash)
		if err != nil {
			t.Fatalf("decode prevHash: %v", err)
		}
		concat = append(concat, prevBytes...)
	}
	sum2 := sha256Sum(concat)
	if hex.EncodeToString(sum2) != got.Hash {
		t.Fatalf("hash mismatch: computed=%s stored=%s", hex.EncodeToString(sum2), got.Hash)
	}

	// verify signature using registry
	ki, ok := reg.GetSigner(got.SignerId)
	if !ok {
		t.Fatalf("signer not found in registry: %s", got.SignerId)
	}
	pub, err := base64.StdEncoding.DecodeString(ki.PublicKey)
	if err != nil {
		t.Fatalf("invalid public key: %v", err)
	}
	sigBytes, err := base64.StdEncoding.DecodeString(got.Signature)
	if err != nil {
		t.Fatalf("invalid signature: %v", err)
	}
	if !ed25519.Verify(ed25519.PublicKey(pub), sum2, sigBytes) {
		t.Fatalf("signature verify failed")
	}
}

