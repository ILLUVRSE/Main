package audit

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ILLUVRSE/Main/kernel/internal/canonical"
	"github.com/ILLUVRSE/Main/kernel/internal/signer"
)

// PGStore persists audit and signature records into Postgres.
type PGStore struct {
	db *sql.DB
}

// NewPGStore constructs a Postgres-backed store.
func NewPGStore(db *sql.DB) *PGStore {
	return &PGStore{db: db}
}

// Ping verifies connectivity to Postgres.
func (p *PGStore) Ping(ctx context.Context) error {
	return p.db.PingContext(ctx)
}

// InsertManifestSignature persists a ManifestSignature row.
func (p *PGStore) InsertManifestSignature(ctx context.Context, ms *ManifestSignature) error {
	if ms.ID == "" {
		ms.ID = NewUUID()
	}
	if ms.Ts.IsZero() {
		ms.Ts = time.Now().UTC()
	}

	q := `
		INSERT INTO manifest_signatures (id, manifest_id, signer_id, signature, version, ts)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	_, err := p.db.ExecContext(ctx, q, ms.ID, ms.ManifestId, ms.SignerId, ms.Signature, ms.Version, ms.Ts)
	return err
}

// lastHash returns the latest hash from audit_events or empty string if none.
func (p *PGStore) lastHash(ctx context.Context) (string, error) {
	var h sql.NullString
	q := `SELECT hash FROM audit_events ORDER BY ts DESC LIMIT 1`
	if err := p.db.QueryRowContext(ctx, q).Scan(&h); err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	if !h.Valid {
		return "", nil
	}
	return h.String, nil
}

// AppendAuditEvent canonicalizes payload, computes hash (sha256(canonical||prevHashBytes)),
// requests a signature from signer, and persists the event into Postgres.
func (p *PGStore) AppendAuditEvent(ctx context.Context, ev *AuditEvent, s signer.Signer) error {
	// Canonicalize payload
	canon, err := canonical.MarshalCanonical(ev.Payload)
	if err != nil {
		return fmt.Errorf("canonicalize payload: %w", err)
	}

	// Get prevHash
	prev, err := p.lastHash(ctx)
	if err != nil {
		return fmt.Errorf("fetch last hash: %w", err)
	}

	// Compute hash bytes = sha256(canonical || prevHashBytes)
	var concat []byte
	concat = append(concat, canon...)
	if prev != "" {
		prevBytes, err := hex.DecodeString(prev)
		if err != nil {
			return fmt.Errorf("decode prev hash: %w", err)
		}
		concat = append(concat, prevBytes...)
	}
	hash := HashBytes(concat)

	// Request signature from signer
	sig, signerId, err := s.Sign(hash)
	if err != nil {
		return fmt.Errorf("sign hash: %w", err)
	}
	signatureB64 := base64.StdEncoding.EncodeToString(sig)

	// Populate event fields
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

	// Marshal payload and metadata for JSONB insertion
	payloadJSON, err := json.Marshal(ev.Payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	var metadataJSON []byte
	if ev.Metadata != nil {
		metadataJSON, err = json.Marshal(ev.Metadata)
		if err != nil {
			return fmt.Errorf("marshal metadata: %w", err)
		}
	} else {
		metadataJSON = []byte("null")
	}

	// Insert into audit_events
	q := `
		INSERT INTO audit_events
		  (id, event_type, payload, prev_hash, hash, signature, signer_id, ts, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
	`
	_, err = p.db.ExecContext(ctx, q,
		ev.ID,
		ev.EventType,
		payloadJSON,
		ev.PrevHash,
		ev.Hash,
		ev.Signature,
		ev.SignerId,
		ev.Ts,
		metadataJSON,
	)
	if err != nil {
		return fmt.Errorf("insert audit_event: %w", err)
	}

	return nil
}

// GetAuditEvent fetches an AuditEvent by id and unmarshals JSON fields.
func (p *PGStore) GetAuditEvent(ctx context.Context, id string) (*AuditEvent, error) {
	q := `SELECT id, event_type, payload, prev_hash, hash, signature, signer_id, ts, metadata FROM audit_events WHERE id=$1`
	row := p.db.QueryRowContext(ctx, q, id)

	var (
		idv, eventType, prevHash, hashStr, signature, signerId string
		payloadBytes, metaBytes                                []byte
		ts                                                    time.Time
	)
	if err := row.Scan(&idv, &eventType, &payloadBytes, &prevHash, &hashStr, &signature, &signerId, &ts, &metaBytes); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query audit_event: %w", err)
	}

	var payload interface{}
	if len(payloadBytes) > 0 {
		if err := json.Unmarshal(payloadBytes, &payload); err != nil {
			// If unmarshalling fails, keep raw bytes as string to avoid losing data
			payload = string(payloadBytes)
		}
	}

	var metadata interface{}
	if len(metaBytes) > 0 && string(metaBytes) != "null" {
		if err := json.Unmarshal(metaBytes, &metadata); err != nil {
			metadata = string(metaBytes)
		}
	}

	ev := &AuditEvent{
		ID:        idv,
		EventType: eventType,
		Payload:   payload,
		PrevHash:  prevHash,
		Hash:      hashStr,
		Signature: signature,
		SignerId:  signerId,
		Ts:        ts,
		Metadata:  metadata,
	}
	return ev, nil
}

