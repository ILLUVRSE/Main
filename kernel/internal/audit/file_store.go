package audit

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/ILLUVRSE/Main/kernel/internal/canonical"
	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

// FileStore is a simple file-backed store for dev/testing.
// It archives audit events as JSON files and keeps a head.hash file for the latest head.
type FileStore struct {
	dir string
}

// NewFileStore returns a new FileStore and ensures the archive directory exists.
func NewFileStore(dir string) *FileStore {
	_ = os.MkdirAll(dir, 0o755)
	return &FileStore{dir: dir}
}

func (f *FileStore) Ping(ctx context.Context) error { return nil }

func (f *FileStore) InsertManifestSignature(ctx context.Context, ms *ManifestSignature) error {
	if ms.ID == "" {
		ms.ID = NewUUID()
	}
	if ms.Ts.IsZero() {
		ms.Ts = time.Now().UTC()
	}
	b, _ := json.MarshalIndent(ms, "", "  ")
	path := filepath.Join(f.dir, fmt.Sprintf("manifest_signature_%s.json", ms.ID))
	return os.WriteFile(path, b, 0o644)
}

// AppendAuditEvent canonicalizes payload, computes prev/hash, requests a signature
// from signer.Signer, and writes the event JSON and head.hash to the archive directory.
func (f *FileStore) AppendAuditEvent(ctx context.Context, ev *AuditEvent, s signer.Signer) error {
	// canonicalize payload
	canon, err := canonical.MarshalCanonical(ev.Payload)
	if err != nil {
		return fmt.Errorf("canonicalize payload: %w", err)
	}

	// read previous head hash
	prev := f.readHead()

	// compute new hash = sha256(canonical || prevHashBytes)
	var concat []byte
	concat = append(concat, canon...)
	if prev != "" {
		prevBytes, err := hex.DecodeString(prev)
		if err != nil {
			return fmt.Errorf("decode prevHash: %w", err)
		}
		concat = append(concat, prevBytes...)
	}
	hash := HashBytes(concat)

	// sign the hash using signer.Signer
	sig, signerId, err := s.Sign(hash)
	if err != nil {
		return fmt.Errorf("sign hash: %w", err)
	}
	signatureB64 := base64.StdEncoding.EncodeToString(sig)

	if ev.ID == "" {
		ev.ID = NewUUID()
	}
	ev.PrevHash = prev
	ev.Hash = hex.EncodeToString(hash)
	ev.Signature = signatureB64
	ev.SignerId = signerId
	if ev.Ts.IsZero() {
		ev.Ts = time.Now().UTC()
	}

	// persist event to file
	b, _ := json.MarshalIndent(ev, "", "  ")
	path := filepath.Join(f.dir, fmt.Sprintf("audit_%s.json", ev.ID))
	if err := os.WriteFile(path, b, 0o644); err != nil {
		return fmt.Errorf("write audit file: %w", err)
	}

	// update head.hash
	if err := os.WriteFile(filepath.Join(f.dir, "head.hash"), []byte(ev.Hash), 0o644); err != nil {
		return fmt.Errorf("write head.hash: %w", err)
	}

	return nil
}

func (f *FileStore) readHead() string {
	b, err := os.ReadFile(filepath.Join(f.dir, "head.hash"))
	if err != nil {
		return ""
	}
	return string(b)
}

func (f *FileStore) GetAuditEvent(ctx context.Context, id string) (*AuditEvent, error) {
	path := filepath.Join(f.dir, fmt.Sprintf("audit_%s.json", id))
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	var ev AuditEvent
	if err := json.Unmarshal(b, &ev); err != nil {
		return nil, err
	}
	return &ev, nil
}

