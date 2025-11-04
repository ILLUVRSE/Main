package audit

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ILLUVRSE/Main/kernel/internal/canonical"
	"github.com/ILLUVRSE/Main/kernel/internal/keys"
)

// VerifyChain walks the audit_events table in chronological order and verifies:
//   - hash correctness: hash == SHA256(canonical(payload) || prevHashBytes)
//   - signature correctness: Ed25519 verify using signer public key from registry
//
// Returns nil on success or an error describing the first problem encountered.
func VerifyChain(ctx context.Context, db *sql.DB, reg *keys.Registry) error {
	if db == nil {
		return errors.New("db is nil")
	}
	if reg == nil {
		return errors.New("key registry is nil")
	}

	q := `SELECT id, event_type, payload, prev_hash, hash, signature, signer_id FROM audit_events ORDER BY ts ASC`
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return fmt.Errorf("query audit_events: %w", err)
	}
	defer rows.Close()

	var (
		idStr     string
		eventType string
		payloadB  []byte
		prevHash  sql.NullString
		hashHex   string
		signB64   string
		signerId  string
	)

	index := 0
	for rows.Next() {
		index++
		if err := rows.Scan(&idStr, &eventType, &payloadB, &prevHash, &hashHex, &signB64, &signerId); err != nil {
			return fmt.Errorf("scan row %d: %w", index, err)
		}

		// Unmarshal payload JSON into interface{} so canonicalization matches original
		var payload interface{}
		if err := json.Unmarshal(payloadB, &payload); err != nil {
			// payload might be raw string if unmarshal not needed, but fail here for safety
			return fmt.Errorf("unmarshal payload for event %s: %w", idStr, err)
		}

		// Canonicalize payload
		canon, err := canonical.MarshalCanonical(payload)
		if err != nil {
			return fmt.Errorf("canonicalize payload for event %s: %w", idStr, err)
		}

		// Build concat = canonical || prevHashBytes (prevHash is hex string; if empty use nothing)
		var concat []byte
		concat = append(concat, canon...)
		if prevHash.Valid && prevHash.String != "" {
			prevBytes, err := hex.DecodeString(prevHash.String)
			if err != nil {
				return fmt.Errorf("decode prevHash for event %s: %w", idStr, err)
			}
			concat = append(concat, prevBytes...)
		}

		// Compute SHA-256
		sum := sha256.Sum256(concat)
		computedHex := hex.EncodeToString(sum[:])

		// Compare computed hash with stored hash
		if computedHex != hashHex {
			return fmt.Errorf("hash mismatch for event %s (type=%s): computed=%s stored=%s", idStr, eventType, computedHex, hashHex)
		}

		// Verify signature using signer public key from registry
		ki, ok := reg.GetSigner(signerId)
		if !ok {
			return fmt.Errorf("unknown signer %s for event %s", signerId, idStr)
		}
		pubBytes, err := base64.StdEncoding.DecodeString(ki.PublicKey)
		if err != nil {
			return fmt.Errorf("invalid public key for signer %s: %w", signerId, err)
		}
		sigBytes, err := base64.StdEncoding.DecodeString(signB64)
		if err != nil {
			return fmt.Errorf("invalid signature encoding for event %s: %w", idStr, err)
		}

		if !ed25519.Verify(ed25519.PublicKey(pubBytes), sum[:], sigBytes) {
			return fmt.Errorf("signature verification failed for event %s with signer %s", idStr, signerId)
		}
	}

	if err := rows.Err(); err != nil {
		return fmt.Errorf("rows iteration error: %w", err)
	}

	return nil
}
