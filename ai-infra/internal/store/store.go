package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/ILLUVRSE/Main/ai-infra/internal/models"
)

var ErrNotFound = errors.New("not found")

type Store interface {
	CreateTrainingJob(ctx context.Context, in TrainingJobInput) (models.TrainingJob, error)
	CreateArtifact(ctx context.Context, in ArtifactInput) (models.ModelArtifact, error)
	GetArtifact(ctx context.Context, id uuid.UUID) (models.ModelArtifact, error)
	CreatePromotion(ctx context.Context, in PromotionInput) (models.ModelPromotion, error)
	UpdatePromotionStatus(ctx context.Context, in PromotionStatusUpdate) (models.ModelPromotion, error)
	Ping(ctx context.Context) error
}

type PGStore struct {
	db *sql.DB
}

func NewPGStore(db *sql.DB) *PGStore {
	return &PGStore{db: db}
}

type TrainingJobInput struct {
	ID              uuid.UUID
	CodeRef         string
	ContainerDigest string
	Hyperparams     json.RawMessage
	DatasetRefs     json.RawMessage
	Seed            int64
	Status          string
}

type ArtifactInput struct {
	ID                  uuid.UUID
	TrainingJobID       uuid.UUID
	ArtifactURI         string
	Checksum            string
	Metadata            json.RawMessage
	SignerID            string
	Signature           string
	ManifestSignatureID *string
}

type PromotionInput struct {
	ID          uuid.UUID
	ArtifactID  uuid.UUID
	Environment string
	Status      string
	Evaluation  json.RawMessage
}

type PromotionStatusUpdate struct {
	ID               uuid.UUID
	Status           string
	SentinelDecision json.RawMessage
	PromotedBy       string
	PromotedAt       *time.Time
	Signature        *string
	SignerID         *string
}

func ensureJSON(raw json.RawMessage, fallback string) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(fallback)
	}
	return raw
}

func (s *PGStore) CreateTrainingJob(ctx context.Context, in TrainingJobInput) (models.TrainingJob, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	query := `
		INSERT INTO training_jobs (id, code_ref, container_digest, hyperparams, dataset_refs, seed, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at, updated_at
	`
	var created, updated time.Time
	if err := s.db.QueryRowContext(ctx, query, in.ID, in.CodeRef, in.ContainerDigest, ensureJSON(in.Hyperparams, "{}"), ensureJSON(in.DatasetRefs, "[]"), in.Seed, in.Status).Scan(&created, &updated); err != nil {
		return models.TrainingJob{}, fmt.Errorf("insert training job: %w", err)
	}
	return models.TrainingJob{
		ID:              in.ID,
		CodeRef:         in.CodeRef,
		ContainerDigest: in.ContainerDigest,
		Hyperparams:     ensureJSON(in.Hyperparams, "{}"),
		DatasetRefs:     ensureJSON(in.DatasetRefs, "[]"),
		Seed:            in.Seed,
		Status:          in.Status,
		CreatedAt:       created,
		UpdatedAt:       updated,
	}, nil
}

func (s *PGStore) CreateArtifact(ctx context.Context, in ArtifactInput) (models.ModelArtifact, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	query := `
		INSERT INTO model_artifacts (id, training_job_id, artifact_uri, checksum, metadata, signer_id, signature, manifest_signature_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING created_at
	`
	var created time.Time
	if err := s.db.QueryRowContext(ctx, query, in.ID, in.TrainingJobID, in.ArtifactURI, in.Checksum, ensureJSON(in.Metadata, "{}"), in.SignerID, in.Signature, in.ManifestSignatureID).Scan(&created); err != nil {
		return models.ModelArtifact{}, fmt.Errorf("insert model artifact: %w", err)
	}
	return models.ModelArtifact{
		ID:                  in.ID,
		TrainingJobID:       in.TrainingJobID,
		ArtifactURI:         in.ArtifactURI,
		Checksum:            in.Checksum,
		Metadata:            ensureJSON(in.Metadata, "{}"),
		SignerID:            in.SignerID,
		Signature:           in.Signature,
		ManifestSignatureID: in.ManifestSignatureID,
		CreatedAt:           created,
	}, nil
}

func (s *PGStore) GetArtifact(ctx context.Context, id uuid.UUID) (models.ModelArtifact, error) {
	const query = `
		SELECT id, training_job_id, artifact_uri, checksum, metadata, signer_id, signature, manifest_signature_id, created_at
		FROM model_artifacts
		WHERE id = $1
	`
	var artifact models.ModelArtifact
	var metadata []byte
	var manifest sql.NullString
	if err := s.db.QueryRowContext(ctx, query, id).Scan(
		&artifact.ID,
		&artifact.TrainingJobID,
		&artifact.ArtifactURI,
		&artifact.Checksum,
		&metadata,
		&artifact.SignerID,
		&artifact.Signature,
		&manifest,
		&artifact.CreatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.ModelArtifact{}, ErrNotFound
		}
		return models.ModelArtifact{}, fmt.Errorf("get artifact: %w", err)
	}
	artifact.Metadata = append(json.RawMessage(nil), metadata...)
	if manifest.Valid {
		artifact.ManifestSignatureID = &manifest.String
	}
	return artifact, nil
}

func (s *PGStore) CreatePromotion(ctx context.Context, in PromotionInput) (models.ModelPromotion, error) {
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	query := `
		INSERT INTO model_promotions (id, artifact_id, environment, status, evaluation)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING created_at
	`
	var created time.Time
	if err := s.db.QueryRowContext(ctx, query, in.ID, in.ArtifactID, in.Environment, in.Status, ensureJSON(in.Evaluation, "{}")).Scan(&created); err != nil {
		return models.ModelPromotion{}, fmt.Errorf("insert promotion: %w", err)
	}
	return models.ModelPromotion{
		ID:          in.ID,
		ArtifactID:  in.ArtifactID,
		Environment: in.Environment,
		Status:      in.Status,
		Evaluation:  ensureJSON(in.Evaluation, "{}"),
		CreatedAt:   created,
	}, nil
}

func (s *PGStore) UpdatePromotionStatus(ctx context.Context, in PromotionStatusUpdate) (models.ModelPromotion, error) {
	query := `
		UPDATE model_promotions
		SET status=$2,
		    sentinel_decision=$3,
		    promoted_by=$4,
		    promoted_at=$5,
		    signature=$6,
		    signer_id=$7
		WHERE id=$1
		RETURNING artifact_id, environment, evaluation, sentinel_decision, promoted_by, promoted_at, signature, signer_id, created_at, status
	`
	var (
		promotion  models.ModelPromotion
		evalBytes  []byte
		sentinel   []byte
		promotedAt sql.NullTime
		signature  sql.NullString
		signer     sql.NullString
	)
	err := s.db.QueryRowContext(ctx, query, in.ID, in.Status, in.SentinelDecision, in.PromotedBy, in.PromotedAt, in.Signature, in.SignerID).Scan(
		&promotion.ArtifactID,
		&promotion.Environment,
		&evalBytes,
		&sentinel,
		&promotion.PromotedBy,
		&promotedAt,
		&signature,
		&signer,
		&promotion.CreatedAt,
		&promotion.Status,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return models.ModelPromotion{}, ErrNotFound
		}
		return models.ModelPromotion{}, fmt.Errorf("update promotion status: %w", err)
	}
	promotion.ID = in.ID
	promotion.Evaluation = append(json.RawMessage(nil), evalBytes...)
	if len(sentinel) > 0 {
		promotion.SentinelDecision = append(json.RawMessage(nil), sentinel...)
	}
	if promotedAt.Valid {
		t := promotedAt.Time
		promotion.PromotedAt = &t
	}
	if signature.Valid {
		v := signature.String
		promotion.Signature = &v
	}
	if signer.Valid {
		v := signer.String
		promotion.SignerID = &v
	}
	return promotion, nil
}

func (s *PGStore) Ping(ctx context.Context) error {
	if err := s.db.PingContext(ctx); err != nil {
		return fmt.Errorf("db ping: %w", err)
	}
	return nil
}
