package keys

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"time"
)

// Store is a Postgres-backed signer registry.
type Store struct {
	db *sql.DB
}

// NewStore returns a Store and ensures the signers table exists.
func NewStore(db *sql.DB) (*Store, error) {
	s := &Store{db: db}
	if err := s.ensureTable(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) ensureTable() error {
	const q = `
CREATE TABLE IF NOT EXISTS signers (
  signer_id text PRIMARY KEY,
  algorithm text NOT NULL,
  public_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signers_created_at ON signers (created_at DESC);
`
	_, err := s.db.Exec(q)
	return err
}

// AddSigner inserts or updates a signer record.
func (s *Store) AddSigner(ctx context.Context, signerId string, pubKey []byte, algorithm string) error {
	pubB64 := base64.StdEncoding.EncodeToString(pubKey)
	const q = `
INSERT INTO signers (signer_id, algorithm, public_key, created_at)
VALUES ($1,$2,$3, now())
ON CONFLICT (signer_id) DO UPDATE
  SET algorithm = EXCLUDED.algorithm,
      public_key = EXCLUDED.public_key,
      created_at = EXCLUDED.created_at
`
	_, err := s.db.ExecContext(ctx, q, signerId, algorithm, pubB64)
	return err
}

// GetSigner fetches a signer by id. Returns (KeyInfo, true, nil) if found, (nil,false,nil) if not found.
func (s *Store) GetSigner(ctx context.Context, signerId string) (*KeyInfo, bool, error) {
	const q = `SELECT signer_id, algorithm, public_key, created_at FROM signers WHERE signer_id=$1`
	row := s.db.QueryRowContext(ctx, q, signerId)
	var (
		id        string
		alg       string
		pubB64    string
		createdAt time.Time
	)
	if err := row.Scan(&id, &alg, &pubB64, &createdAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("query signer: %w", err)
	}
	return &KeyInfo{
		SignerId:  id,
		Algorithm: alg,
		PublicKey: pubB64,
		CreatedAt: createdAt,
	}, true, nil
}

// ListSigners returns all registered signers ordered by created_at desc.
func (s *Store) ListSigners(ctx context.Context) ([]KeyInfo, error) {
	const q = `SELECT signer_id, algorithm, public_key, created_at FROM signers ORDER BY created_at DESC`
	rows, err := s.db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("query signers: %w", err)
	}
	defer rows.Close()

	out := make([]KeyInfo, 0)
	for rows.Next() {
		var id, alg, pubB64 string
		var createdAt time.Time
		if err := rows.Scan(&id, &alg, &pubB64, &createdAt); err != nil {
			return nil, fmt.Errorf("scan signer row: %w", err)
		}
		out = append(out, KeyInfo{
			SignerId:  id,
			Algorithm: alg,
			PublicKey: pubB64,
			CreatedAt: createdAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error: %w", err)
	}
	return out, nil
}

// DeleteSigner deletes a signer by id.
func (s *Store) DeleteSigner(ctx context.Context, signerId string) error {
	const q = `DELETE FROM signers WHERE signer_id=$1`
	_, err := s.db.ExecContext(ctx, q, signerId)
	return err
}

