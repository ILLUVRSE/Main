package audit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"

	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

// Store defines the minimal persistence abstraction the Kernel uses for audit and signatures.
type Store interface {
	// InsertManifestSignature persists a ManifestSignature record.
	InsertManifestSignature(ctx context.Context, ms *ManifestSignature) error

	// AppendAuditEvent canonicalizes payload, computes the hash/prevHash, requests a signature
	// via the provided signer, and persists the resulting AuditEvent.
	AppendAuditEvent(ctx context.Context, ev *AuditEvent, s signer.Signer) error

	// GetAuditEvent retrieves an AuditEvent by id.
	GetAuditEvent(ctx context.Context, id string) (*AuditEvent, error)

	// Ping validates the store is reachable/healthy.
	Ping(ctx context.Context) error
}

// HashBytes computes the SHA-256 digest bytes for input data.
func HashBytes(b []byte) []byte {
	h := sha256.Sum256(b)
	return h[:]
}

// HashHex returns the hex-encoded SHA-256 of the input bytes.
func HashHex(b []byte) string {
	return hex.EncodeToString(HashBytes(b))
}
