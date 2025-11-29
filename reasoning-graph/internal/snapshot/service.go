package snapshot

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/ILLUVRSE/Main/reasoning-graph/internal/canonical"
)

// Snapshot represents a versioned state of the reasoning graph.
type Snapshot struct {
	ID                  string      `json:"id"`
	RootIDs             []string    `json:"root_ids"`
	CreatedAt           time.Time   `json:"created_at"`
	ReasoningGraphVer   string      `json:"reasoning_graph_version"`
	ManifestSignatureID string      `json:"manifest_signature_id,omitempty"` // Optional binding to a manifest
	Payload             interface{} `json:"payload"`                         // The actual graph data (nodes, edges)
}

// PersistedSnapshot is what is stored in the DB, including signature.
type PersistedSnapshot struct {
	Snapshot
	CanonicalHash string `json:"snapshot_bytes_canonical_hash"`
	SignerKID     string `json:"signer_kid"`
	Signature     string `json:"signature"`
}

// Signer is an interface for signing data.
type Signer interface {
	Sign(ctx context.Context, data []byte) (signature string, signerKID string, err error)
}

// Service handles snapshot creation and signing.
type Service struct {
	signer Signer
	store  Store
}

// Store is an interface for persisting snapshots.
type Store interface {
	SaveSnapshot(ctx context.Context, snapshot *PersistedSnapshot) error
}

func NewService(signer Signer, store Store) *Service {
	return &Service{
		signer: signer,
		store:  store,
	}
}

// CreateSnapshotAndSign creates a snapshot, canonicalizes it, signs it, and persists it.
func (s *Service) CreateSnapshotAndSign(ctx context.Context, id string, rootIDs []string, payload interface{}, manifestSigID string) (*PersistedSnapshot, error) {
	snap := Snapshot{
		ID:                  id,
		RootIDs:             rootIDs,
		CreatedAt:           time.Now().UTC(),
		ReasoningGraphVer:   "1.0.0",
		ManifestSignatureID: manifestSigID,
		Payload:             payload,
	}

	// 1. Canonicalize
	canonicalBytes, err := canonical.Canonicalize(snap)
	if err != nil {
		return nil, fmt.Errorf("failed to canonicalize snapshot: %w", err)
	}

	// 2. Compute SHA256 Hash
	hash := sha256.Sum256(canonicalBytes)
	hashStr := base64.StdEncoding.EncodeToString(hash[:])

	// 3. Sign
	signature, signerKID, err := s.signer.Sign(ctx, hash[:]) // Signing the raw hash bytes usually, or the hash string? Kernel signs the payload usually.
	// Wait, the task says: "invoking KMS/HSM to sign the canonical snapshot hash."
	// Kernel's LocalSigningProvider signs the payload bytes directly if passing bytes, or maybe the hash.
	// Let's check Kernel's logic. Kernel's `signData` signs the payload.
	// But usually for large blobs we sign the hash.
	// Task says: "requests Kernel signer to sign ... the canonical snapshot hash".
	// So I should sign the hash.

	if err != nil {
		return nil, fmt.Errorf("failed to sign snapshot: %w", err)
	}

	persisted := &PersistedSnapshot{
		Snapshot:      snap,
		CanonicalHash: hashStr,
		SignerKID:     signerKID,
		Signature:     signature,
	}

	// 4. Persist
	if err := s.store.SaveSnapshot(ctx, persisted); err != nil {
		return nil, fmt.Errorf("failed to save snapshot: %w", err)
	}

	return persisted, nil
}
