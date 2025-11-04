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
		ts                                                     time.Time
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

//
// New methods for Phase 3: DB-first durable streaming support
//

// FetchPendingEventsForStreaming selects a batch of pending/retry audit events,
// claims them by setting stream_status='in_progress' and incrementing stream_attempts,
// and returns the canonical AuditEvent objects ready for streaming/archival.
// It uses SELECT ... FOR UPDATE SKIP LOCKED semantics to allow multiple workers.
func (p *PGStore) FetchPendingEventsForStreaming(ctx context.Context, batchSize int) ([]*AuditEvent, error) {
	if batchSize <= 0 {
		batchSize = 10
	}

	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	// ensure rollback if we bail out; if we commit successfully we'll set tx = nil
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	q := `
	SELECT id, event_type, payload, prev_hash, hash, signature, signer_id, ts, metadata
	FROM audit_events
	WHERE stream_status IN ('pending','retry')
	ORDER BY ts ASC
	FOR UPDATE SKIP LOCKED
	LIMIT $1
	`
	rows, err := tx.QueryContext(ctx, q, batchSize)
	if err != nil {
		return nil, fmt.Errorf("select pending events: %w", err)
	}
	defer rows.Close()

	ids := make([]string, 0)
	events := make([]*AuditEvent, 0)
	for rows.Next() {
		var (
			idv, eventType, prevHash, hashStr, signature, signerId string
			payloadBytes, metaBytes                                []byte
			ts                                                     time.Time
		)
		if err := rows.Scan(&idv, &eventType, &payloadBytes, &prevHash, &hashStr, &signature, &signerId, &ts, &metaBytes); err != nil {
			return nil, fmt.Errorf("scan pending row: %w", err)
		}

		var payload interface{}
		if len(payloadBytes) > 0 {
			if err := json.Unmarshal(payloadBytes, &payload); err != nil {
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
		events = append(events, ev)
		ids = append(ids, idv)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows err: %w", err)
	}

	if len(ids) == 0 {
		if err := tx.Commit(); err != nil {
			return nil, fmt.Errorf("commit empty select: %w", err)
		}
		tx = nil
		return events, nil
	}

	// Claim the rows by updating their stream_status and incrementing attempts.
	// We update rows one-by-one to keep this code simple and avoid dependency on driver-specific array helpers.
	for _, id := range ids {
		_, err := tx.ExecContext(ctx, `
			UPDATE audit_events
			SET stream_status = 'in_progress',
			    stream_attempts = stream_attempts + 1,
			    last_stream_attempt_at = now(),
			    last_stream_error = NULL
			WHERE id = $1
		`, id)
		if err != nil {
			return nil, fmt.Errorf("claim event %s: %w", id, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit claim: %w", err)
	}
	tx = nil

	return events, nil
}

// MarkEventStreamResult records the outcome of streaming/archival for an event.
// - eventID: id of the audit_event row.
// - archivedKey: optional S3 object key (sql.NullString). If valid and success==true this will be persisted.
// - success: whether the combined produce+archive succeeded.
// - errMsg: optional error message (sql.NullString) when success==false.
//
// Behavior:
//   - On success: sets s3_object_key (if provided), sets s3_archived_at (if not already set),
//     clears last_stream_error and marks stream_status='complete'.
//   - On failure: records last_stream_error and sets stream_status to 'retry' unless
//     stream_attempts >= maxStreamAttempts in which case stream_status='failed'.
func (p *PGStore) MarkEventStreamResult(ctx context.Context, eventID string, archivedKey sql.NullString, success bool, errMsg sql.NullString) error {
	const maxStreamAttempts = 5

	if success {
		q := `
			UPDATE audit_events
			SET s3_object_key = $1,
			    s3_archived_at = COALESCE(s3_archived_at, now()),
			    kafka_produced_at = COALESCE(kafka_produced_at, now()),
			    kafka_last_error = NULL,
			    s3_last_error = NULL,
			    last_stream_attempt_at = now(),
			    last_stream_error = NULL,
			    stream_status = 'complete'
			WHERE id = $2
		`
		_, err := p.db.ExecContext(ctx, q, archivedKey, eventID)
		if err != nil {
			return fmt.Errorf("mark stream success: %w", err)
		}
		return nil
	}

	// failure path: set last_stream_error and bump to 'retry' or 'failed' depending on attempts
	q := fmt.Sprintf(`
		UPDATE audit_events
		SET last_stream_attempt_at = now(),
		    last_stream_error = $1,
		    stream_status = CASE WHEN stream_attempts >= %d THEN 'failed' ELSE 'retry' END
		WHERE id = $2
	`, maxStreamAttempts)

	_, err := p.db.ExecContext(ctx, q, errMsg, eventID)
	if err != nil {
		return fmt.Errorf("mark stream failure: %w", err)
	}
	return nil
}
